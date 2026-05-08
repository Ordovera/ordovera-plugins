import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { ServerReport, AuditReport, AnalyzeOptions } from "./types.js";
import type { McpServerInput } from "./types.js";
import { resolveSource, readCommitHash } from "./clone.js";
import {
  extractTools,
  detectUpstreamPackage,
  extractToolsRuntime,
  extractTestToolNames,
} from "./extract.js";
import { refineClassifications } from "./classify.js";
import {
  scanPatterns,
  assessAuthArchitecture,
  detectFrameworkImports,
  hasLogAdjacentAttribution,
} from "./patterns.js";
import { buildServerReport, buildAuditReport } from "./report.js";
import { detectGaps } from "./gaps.js";
import { deriveIndicators } from "./indicators.js";
import {
  fetchToolsRemote,
  mapRpcToolsToExtracted,
  isRpcError,
} from "./rpc-client.js";
import type { RpcToolsResult } from "./rpc-client.js";

/**
 * Detect the primary language of a repo by file extension frequency.
 */
function detectLanguage(
  repoPath: string
): ServerReport["language"] {
  const counts = { ts: 0, js: 0, py: 0, go: 0 };

  function walk(dir: string, depth = 0): void {
    if (depth > 4) return;
    const skip = new Set([
      "node_modules", ".git", "dist", "build", "__pycache__",
    ]);

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.name.endsWith(".ts")) {
        counts.ts++;
      } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
        counts.js++;
      } else if (entry.name.endsWith(".py")) {
        counts.py++;
      } else if (entry.name.endsWith(".go")) {
        counts.go++;
      }
    }
  }

  walk(repoPath);

  const max = Math.max(counts.ts, counts.js, counts.py, counts.go);
  if (max === 0) return "unknown";
  if (counts.go === max) return "go";
  if (counts.ts >= counts.js && counts.ts >= counts.py) {
    return counts.ts > 0 ? "typescript" : "unknown";
  }
  if (counts.py >= counts.js) return "python";
  return counts.js > 0 ? "javascript" : "unknown";
}

/**
 * Analyze a single MCP server and return a structured report.
 */
export function analyzeServer(
  input: McpServerInput,
  options: AnalyzeOptions = {}
): ServerReport {
  const { localPath, repoName } = resolveSource(input.source);
  const name = input.name ?? repoName;
  const commitHash = readCommitHash(localPath);
  const warnings: string[] = [];

  const language = detectLanguage(localPath);
  if (language === "unknown") {
    warnings.push(
      "Could not detect primary language. Tool extraction may be incomplete."
    );
  }

  let rawTools = extractTools(localPath);
  let tools = refineClassifications(rawTools);
  let upstreamPackage: string | null = null;

  if (tools.length === 0) {
    // Loud miss: detect framework imports to distinguish "no MCP server here"
    // from "MCP server with unsupported registration pattern"
    const frameworks = detectFrameworkImports(localPath);
    if (frameworks.length > 0) {
      // Check if this is a thin wrapper around an upstream dependency
      upstreamPackage = detectUpstreamPackage(localPath);
      if (upstreamPackage) {
        // Layer B: runtime extraction when --deep-extract is set
        if (options.deepExtract) {
          const { tools: runtimeTools, runtimeWarnings } =
            extractToolsRuntime(localPath, upstreamPackage);
          warnings.push(...runtimeWarnings);
          if (runtimeTools.length > 0) {
            rawTools = runtimeTools;
            tools = refineClassifications(rawTools);
          }
        }

        // Only emit the wrapper warning if runtime extraction didn't find tools
        if (tools.length === 0) {
          warnings.push(
            `MCP framework detected (${frameworks.join("; ")}) but no tools were extracted. ` +
            `This repo appears to be a wrapper around \`${upstreamPackage}\` -- ` +
            "audit the upstream package for tool definitions."
          );
        }
      } else {
        warnings.push(
          `MCP framework detected (${frameworks.join("; ")}) but no tools were extracted. ` +
          "This server likely uses a registration pattern not covered by automated extraction -- manual review required."
        );
      }
    } else {
      warnings.push(
        "No tools extracted and no MCP framework imports detected. " +
        "This may not be an MCP server, or it uses an unrecognized framework."
      );
    }
  }

  // Layer A: test coverage cross-check
  const testToolResults = extractTestToolNames(localPath);
  const extractedNames = new Set(tools.map((t) => t.name));
  const testToolCoverage = testToolResults.map((result) => {
    const assertedNames = new Set(result.names);
    return {
      names: result.names,
      sourceFile: result.sourceFile,
      coverage: {
        extractedCount: tools.length,
        assertedCount: result.names.length,
        missingFromExtraction: result.names.filter((n) => !extractedNames.has(n)),
        missingFromTests: tools.map((t) => t.name).filter((n) => !assertedNames.has(n)),
      },
    };
  });

  const patterns = scanPatterns(localPath);
  const toolFiles = new Set(tools.map((t) => t.sourceFile));
  const authArch = assessAuthArchitecture(patterns, toolFiles);

  const report = buildServerReport(
    name,
    input.source,
    language,
    tools,
    patterns,
    warnings,
    commitHash
  );

  report.upstreamPackage = upstreamPackage;
  if (testToolCoverage.length > 0) {
    report.testToolCoverage = testToolCoverage;
  }
  report.flags.hasPerToolAuth = authArch === "per-tool";
  report.flags.hasAttributionIdentifiers = patterns.actorAttribution.length > 0;
  report.flags.hasAttributedLogging = hasLogAdjacentAttribution(patterns);

  if (authArch === "unclear") {
    report.warnings.push(
      "Auth architecture is ambiguous -- found auth patterns in both tool files and separate modules."
    );
  }

  // Detect named accountability gap patterns
  report.accountabilityGaps = detectGaps(tools, patterns, authArch);

  // Derive three-valued coding indicators from the populated report
  report.indicators = deriveIndicators(report);

  return report;
}

/**
 * Analyze a remote MCP server via tools/list RPC.
 *
 * Used for servers that have no cloneable source code (remote-only).
 * Produces a ServerReport with tool inventory but empty governance patterns
 * (auth, logging, gates cannot be assessed without source).
 */
export async function analyzeServerRemote(
  endpointUrl: string,
  options: {
    name?: string;
    transport?: "streamable-http" | "sse";
    timeoutMs?: number;
  } = {}
): Promise<ServerReport> {
  const warnings: string[] = [];

  const result = await fetchToolsRemote(
    endpointUrl,
    options.transport,
    options.timeoutMs
  );

  if (isRpcError(result)) {
    // Build a minimal report with the error
    const name = options.name ?? endpointUrl;
    warnings.push(`RPC introspection failed: ${result.message}`);
    if (result.type === "auth-required") {
      warnings.push("Server requires authentication -- tool inventory unavailable without credentials.");
    }

    const emptyPatterns = {
      auth: [], logging: [], gates: [], stagedExecution: [],
      actorAttribution: [], rateLimit: [], leastPrivilege: [],
    };

    const report = buildServerReport(
      name, endpointUrl, "unknown", [], emptyPatterns, warnings, null
    );
    report.indicators = deriveIndicators(report);
    return report;
  }

  // Success -- map tools and build report
  const rpcResult = result as RpcToolsResult;
  const name = options.name ?? rpcResult.serverName;
  const tools = mapRpcToolsToExtracted(rpcResult.tools, endpointUrl);

  // Check for MCP tool annotations usage
  const annotatedCount = rpcResult.tools.filter(t => t.annotations).length;
  if (annotatedCount > 0) {
    warnings.push(
      `${annotatedCount} of ${rpcResult.tools.length} tools declare MCP annotations (readOnlyHint, destructiveHint, etc.).`
    );
  } else if (rpcResult.tools.length > 0) {
    warnings.push("No tools use MCP annotations -- classification based on name/description heuristics only.");
  }

  warnings.push(
    `Remote-only analysis via ${rpcResult.transportUsed} (protocol ${rpcResult.protocolVersion}). ` +
    "Governance patterns (auth, logging, gates) cannot be assessed without source code."
  );

  // Empty patterns since we have no source code to scan
  const emptyPatterns = {
    auth: [], logging: [], gates: [], stagedExecution: [],
    actorAttribution: [], rateLimit: [], leastPrivilege: [],
  };

  const report = buildServerReport(
    name, endpointUrl, "unknown", tools, emptyPatterns, warnings, null
  );

  // Override indicators to Indeterminate for source-dependent ones
  report.indicators = deriveIndicators(report);
  report.indicators.authentication = "Indeterminate";
  report.indicators.perToolAuth = "Indeterminate";
  report.indicators.auditLogging = "Indeterminate";
  report.indicators.actorAttribution = "Indeterminate";
  report.indicators.confirmationGates = "Indeterminate";
  report.indicators.stagedExecution = "Indeterminate";
  report.indicators.rateLimiting = "Indeterminate";
  report.indicators.leastPrivilege = "Indeterminate";
  report.indicators.sensitiveCapabilityIsolation = "Indeterminate";

  return report;
}

/**
 * Analyze multiple MCP servers and return an aggregate report.
 * Catches per-server errors and continues with remaining servers.
 */
export function analyzeServers(
  inputs: McpServerInput[],
  options: AnalyzeOptions = {}
): AuditReport {
  const servers: ServerReport[] = [];

  for (const input of inputs) {
    try {
      servers.push(analyzeServer(input, options));
    } catch (err) {
      const name = input.name ?? input.source;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Skipping ${name}: ${message}`);

      // Build a minimal failed report so the server shows up in results
      const emptyPatterns = {
        auth: [], logging: [], gates: [], stagedExecution: [],
        actorAttribution: [], rateLimit: [], leastPrivilege: [],
      };
      const failedReport = buildServerReport(
        name, input.source, "unknown", [], emptyPatterns,
        [`Analysis failed: ${message}`], null
      );
      failedReport.indicators = deriveIndicators(failedReport);
      servers.push(failedReport);
    }
  }

  return buildAuditReport(servers);
}

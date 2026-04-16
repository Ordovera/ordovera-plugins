import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { ServerReport, AuditReport } from "./types.js";
import type { McpServerInput } from "./types.js";
import { resolveSource } from "./clone.js";
import { extractTools } from "./extract.js";
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

/**
 * Detect the primary language of a repo by file extension frequency.
 */
function detectLanguage(
  repoPath: string
): ServerReport["language"] {
  const counts = { ts: 0, js: 0, py: 0 };

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
      }
    }
  }

  walk(repoPath);

  if (counts.ts >= counts.js && counts.ts >= counts.py) {
    return counts.ts > 0 ? "typescript" : "unknown";
  }
  if (counts.py >= counts.js) return "python";
  return counts.js > 0 ? "javascript" : "unknown";
}

/**
 * Analyze a single MCP server and return a structured report.
 */
export function analyzeServer(input: McpServerInput): ServerReport {
  const { localPath, repoName } = resolveSource(input.source);
  const name = input.name ?? repoName;
  const warnings: string[] = [];

  const language = detectLanguage(localPath);
  if (language === "unknown") {
    warnings.push(
      "Could not detect primary language. Tool extraction may be incomplete."
    );
  }

  const rawTools = extractTools(localPath);
  const tools = refineClassifications(rawTools);

  if (tools.length === 0) {
    // Loud miss: detect framework imports to distinguish "no MCP server here"
    // from "MCP server with unsupported registration pattern"
    const frameworks = detectFrameworkImports(localPath);
    if (frameworks.length > 0) {
      warnings.push(
        `MCP framework detected (${frameworks.join("; ")}) but no tools were extracted. ` +
        "This server likely uses a registration pattern not covered by automated extraction -- manual review required."
      );
    } else {
      warnings.push(
        "No tools extracted and no MCP framework imports detected. " +
        "This may not be an MCP server, or it uses an unrecognized framework."
      );
    }
  }

  const patterns = scanPatterns(localPath);
  const toolFiles = new Set(tools.map((t) => t.sourceFile));
  const authArch = assessAuthArchitecture(patterns, toolFiles);

  const report = buildServerReport(
    name,
    input.source,
    language,
    tools,
    patterns,
    warnings
  );

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
 * Analyze multiple MCP servers and return an aggregate report.
 */
export function analyzeServers(
  inputs: McpServerInput[]
): AuditReport {
  const servers = inputs.map(analyzeServer);
  return buildAuditReport(servers);
}

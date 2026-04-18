import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import type {
  ServerReport,
  AuditReport,
  EvidenceEnvelope,
  EvidenceBatch,
  EvidenceSourceInfo,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _cachedSource: EvidenceSourceInfo | null = null;

/**
 * Resolve the tool's own source info (version from package.json, commit hash
 * from git). Result is cached for the process lifetime. Throws with a
 * descriptive message if package.json is unreadable or missing a version field.
 */
export function resolveSourceInfo(): EvidenceSourceInfo {
  if (_cachedSource) return _cachedSource;

  const pkgPath = resolve(__dirname, "..", "package.json");
  let version: string;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (typeof pkg.version !== "string" || pkg.version.length === 0) {
      throw new Error(
        `package.json at ${pkgPath} is missing a "version" field`
      );
    }
    version = pkg.version;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`package.json at ${pkgPath} is not valid JSON`);
    }
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`package.json not found at ${pkgPath}`);
    }
    throw err;
  }

  let commitHash: string | null = null;
  try {
    commitHash = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: resolve(__dirname, ".."),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    commitHash = null;
  }

  _cachedSource = { tool: "cc-mcp-audit", version, commitHash };
  return _cachedSource;
}

/**
 * Clear the cached source info. Exported for testing only.
 */
export function _resetSourceCache(): void {
  _cachedSource = null;
}

function buildToolSummary(report: ServerReport) {
  const tools = report.tools;
  return {
    total: tools.length,
    read: tools.filter((t) => t.classification === "read").length,
    write: tools.filter((t) => t.classification === "write").length,
    unknown: tools.filter((t) => t.classification === "unknown").length,
    sensitive: report.sensitiveToolCount,
  };
}

/**
 * Wrap a single ServerReport in a XACML-shaped Evidence envelope.
 *
 * Pass `sourceOverride` to supply pre-resolved source info (useful in
 * tests or when batching to avoid repeated resolution).
 */
export function toEvidence(
  report: ServerReport,
  sourceOverride?: EvidenceSourceInfo
): EvidenceEnvelope {
  const source = sourceOverride ?? resolveSourceInfo();
  return {
    evidenceVersion: "0.1.0",
    source,
    timestamp: new Date().toISOString(),
    subject: {
      name: report.name,
      source: report.source,
      commitHash: report.commitHash,
      language: report.language,
    },
    attributes: {
      indicators: report.indicators,
      gaps: report.accountabilityGaps,
      flags: report.flags,
      toolSummary: buildToolSummary(report),
    },
    fullReport: report,
  };
}

/**
 * Wrap an AuditReport (multiple servers) into an EvidenceBatch.
 */
export function toEvidenceBatch(
  report: AuditReport,
  sourceOverride?: EvidenceSourceInfo
): EvidenceBatch {
  const source = sourceOverride ?? resolveSourceInfo();
  return {
    evidenceVersion: "0.1.0",
    generatedAt: report.generatedAt,
    source,
    envelopes: report.servers.map((s) => toEvidence(s, source)),
    summary: report.summary,
  };
}

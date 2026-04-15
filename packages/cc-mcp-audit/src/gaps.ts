import type {
  AccountabilityGap,
  ExtractedTool,
  PatternMatch,
} from "./types.js";
import type { PatternResults } from "./patterns.js";

const DESTRUCTIVE_KEYWORDS = [
  "drop", "delete", "truncate", "destroy", "purge", "remove", "wipe",
];

/**
 * Detect named accountability gap patterns from extraction and pattern results.
 */
export function detectGaps(
  tools: ExtractedTool[],
  patterns: PatternResults,
  authArchitecture: "per-tool" | "global" | "none" | "unclear"
): AccountabilityGap[] {
  const gaps: AccountabilityGap[] = [];

  const writeTools = tools.filter((t) => t.classification === "write");
  const gateFiles = new Set(patterns.gates.map((g) => g.file));
  const logFiles = new Set(patterns.logging.map((l) => l.file));
  const attrFiles = new Set(patterns.actorAttribution.map((a) => a.file));

  // 1. Ungated write tools: write tool with no gate pattern in the same file
  const ungated = writeTools.filter((t) => !gateFiles.has(t.sourceFile));
  if (ungated.length > 0) {
    gaps.push({
      pattern: "ungated-write",
      instances: ungated.map((t) => ({
        tool: t.name,
        file: t.sourceFile,
        line: t.sourceLine,
      })),
      reviewNote:
        "These write tools have no confirmation gate co-located in their source file. " +
        "Verify whether gates exist at the client layer or in middleware not detected by static analysis.",
    });
  }

  // 2. Global auth over sensitive tools: single auth layer upstream of tools
  //    with very different sensitivity levels
  if (
    (authArchitecture === "global" || authArchitecture === "unclear") &&
    writeTools.length > 0 &&
    tools.some((t) => t.classification === "read")
  ) {
    gaps.push({
      pattern: "global-auth-over-sensitive-tools",
      instances: writeTools.map((t) => ({
        tool: t.name,
        file: t.sourceFile,
        line: t.sourceLine,
      })),
      reviewNote:
        "Auth appears to be applied uniformly across tools with different sensitivity levels. " +
        "A user authorized to read metadata has the same access as one who can modify or delete data. " +
        "Verify whether the auth layer differentiates by operation.",
    });
  }

  // 3. Auth without actor logging: auth patterns present but no actor
  //    attribution in log statements
  if (
    patterns.auth.length > 0 &&
    patterns.logging.length > 0 &&
    patterns.actorAttribution.length === 0
  ) {
    gaps.push({
      pattern: "auth-without-actor-logging",
      instances: patterns.logging.slice(0, 5).map((l) => ({
        file: l.file,
        line: l.line,
      })),
      reviewNote:
        "The server authenticates users and has logging, but log statements do not reference " +
        "a principal identifier (user_id, session_id, actor, etc.). Actions cannot be attributed " +
        "to specific users in the audit trail.",
    });
  }

  // 4. Logging without attribution: logging present but no principal identifiers
  //    anywhere in the codebase (even without auth)
  if (
    patterns.logging.length > 0 &&
    patterns.actorAttribution.length === 0 &&
    patterns.auth.length === 0
  ) {
    gaps.push({
      pattern: "logging-without-attribution",
      instances: patterns.logging.slice(0, 5).map((l) => ({
        file: l.file,
        line: l.line,
      })),
      reviewNote:
        "Logging is present but contains no principal identifiers. " +
        "If this server is deployed behind an auth layer, log entries cannot tie actions to actors.",
    });
  }

  // 5. Destructive tools without audit trail: write tool with irreversible
  //    keywords and no logging in the same file
  const destructiveUnlogged = writeTools.filter((t) => {
    const combined = `${t.name} ${t.description}`.toLowerCase();
    const isDestructive = DESTRUCTIVE_KEYWORDS.some((kw) => combined.includes(kw));
    const hasLogging = logFiles.has(t.sourceFile);
    return isDestructive && !hasLogging;
  });
  if (destructiveUnlogged.length > 0) {
    gaps.push({
      pattern: "destructive-without-audit-trail",
      instances: destructiveUnlogged.map((t) => ({
        tool: t.name,
        file: t.sourceFile,
        line: t.sourceLine,
      })),
      reviewNote:
        "These tools perform irreversible operations (drop, delete, truncate, destroy) " +
        "with no logging in their source file. If something goes wrong, there is no record of what happened.",
    });
  }

  return gaps;
}

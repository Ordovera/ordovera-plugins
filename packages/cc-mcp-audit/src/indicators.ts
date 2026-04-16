import type {
  CodingIndicators,
  IndicatorValue,
  ServerReport,
} from "./types.js";

/**
 * Derive three-valued coding indicators from a ServerReport's flags,
 * patterns, tools, and warnings.
 *
 * Present: positive signal detected with reasonable confidence.
 * Absent: no signal detected, and the tool scanned relevant files.
 * Indeterminate: signal is ambiguous, or extraction was incomplete,
 *   or the indicator depends on runtime behavior.
 */
export function deriveIndicators(report: ServerReport): CodingIndicators {
  const extractionIncomplete = report.tools.length === 0 &&
    report.warnings.some((w) => w.includes("MCP framework detected"));

  return {
    authentication: deriveAuth(report, extractionIncomplete),
    perToolAuth: derivePerToolAuth(report, extractionIncomplete),
    readWriteSeparation: deriveReadWriteSeparation(report, extractionIncomplete),
    leastPrivilege: simple(report.flags.hasLeastPrivilege),
    confirmationGates: deriveGates(report, extractionIncomplete),
    stagedExecution: deriveStagedExecution(report, extractionIncomplete),
    auditLogging: simple(report.flags.hasLogging),
    actorAttribution: deriveAttribution(report),
    rateLimiting: simple(report.flags.hasRateLimiting),
    sensitiveCapabilityIsolation: deriveSensitiveIsolation(
      report,
      extractionIncomplete
    ),
    // Domain 5 indicators are always null -- populated by human review outside
    // the tool. The LLM screening pass (--llm-screen) does not set these; it
    // writes to screeningSignals instead.
    selfModificationPrevention: null,
    subAgentAuthorityConstraints: null,
    permissionBoundaryEnforcement: null,
  };
}

function simple(flag: boolean): IndicatorValue {
  return flag ? "Present" : "Absent";
}

function deriveAuth(
  report: ServerReport,
  extractionIncomplete: boolean
): IndicatorValue {
  if (report.flags.hasAuth) return "Present";
  // No auth detected -- but MCP servers commonly delegate auth to the
  // transport layer, which is invisible to static analysis
  if (extractionIncomplete) return "Indeterminate";
  return "Absent";
}

function derivePerToolAuth(
  report: ServerReport,
  extractionIncomplete: boolean
): IndicatorValue {
  if (!report.flags.hasAuth) return "Absent";
  if (report.flags.hasPerToolAuth) return "Present";
  // Auth exists but the colocation heuristic returned "unclear"
  if (report.warnings.some((w) => w.includes("Auth architecture is ambiguous"))) {
    return "Indeterminate";
  }
  // Auth exists and is clearly global
  return "Absent";
}

function deriveReadWriteSeparation(
  report: ServerReport,
  extractionIncomplete: boolean
): IndicatorValue {
  if (extractionIncomplete) return "Indeterminate";
  if (report.tools.length === 0) return "Indeterminate";

  const hasRead = report.tools.some((t) => t.classification === "read");
  const hasWrite = report.tools.some((t) => t.classification === "write");
  const hasUnknown = report.tools.some((t) => t.classification === "unknown");

  // Server exposes both read and write tools -- separation exists in design
  if (hasRead && hasWrite) return "Present";
  // All tools are the same type -- separation is trivially present (or N/A)
  if ((hasRead && !hasWrite) || (hasWrite && !hasRead)) return "Present";
  // Many unknown classifications undermine confidence
  if (hasUnknown) return "Indeterminate";
  return "Absent";
}

function deriveGates(
  report: ServerReport,
  extractionIncomplete: boolean
): IndicatorValue {
  if (report.flags.hasConfirmationGates) return "Present";
  // No write tools means gates are not applicable -- but "absent" is
  // the accurate coding (the mechanism doesn't exist)
  if (!report.flags.hasWriteTools) return "Absent";
  if (extractionIncomplete) return "Indeterminate";
  return "Absent";
}

function deriveStagedExecution(
  report: ServerReport,
  extractionIncomplete: boolean
): IndicatorValue {
  if (report.flags.hasStagedExecution) return "Present";
  // Same applicability logic as confirmation gates: no write tools means
  // staged execution is not applicable to this server's design
  if (!report.flags.hasWriteTools) return "Absent";
  if (extractionIncomplete) return "Indeterminate";
  return "Absent";
}

function deriveAttribution(report: ServerReport): IndicatorValue {
  if (report.flags.hasAttributedLogging) return "Present";
  if (!report.flags.hasLogging) return "Absent";
  // Logging exists but no log-adjacent attribution -- could be attributed
  // via a mechanism the tool doesn't detect (structured logging config,
  // middleware that injects context)
  if (report.flags.hasAttributionIdentifiers) return "Indeterminate";
  return "Absent";
}

/**
 * Detect design-hygiene signal for sensitive capability isolation.
 *
 * This is a heuristic about observable organization, not runtime isolation.
 * "Present" means the server's design shows deliberate separation between
 * read and write tools via file or namespace structure. It does not prove
 * that capabilities are actually isolated at runtime.
 *
 * Thresholds are deliberately conservative at small n:
 * - Requires at least 3 write tools and 3 read tools before Present is
 *   possible (below that, grouping is noise, not design intent)
 * - Requires clean file-level separation OR consistent namespace prefixes
 * - Anything ambiguous codes as Indeterminate
 */
function deriveSensitiveIsolation(
  report: ServerReport,
  extractionIncomplete: boolean
): IndicatorValue {
  if (extractionIncomplete) return "Indeterminate";
  if (report.tools.length === 0) return "Indeterminate";

  const readTools = report.tools.filter((t) => t.classification === "read");
  const writeTools = report.tools.filter((t) => t.classification === "write");

  // If there are no write tools, capability isolation is not applicable --
  // code as Absent (the mechanism doesn't exist in this server's design)
  if (writeTools.length === 0) return "Absent";

  // Below threshold, grouping is noise rather than deliberate design
  const MIN_PER_BUCKET = 3;
  if (readTools.length < MIN_PER_BUCKET || writeTools.length < MIN_PER_BUCKET) {
    return "Indeterminate";
  }

  // File-level separation: do read and write tools live in distinct files?
  const readFiles = new Set(readTools.map((t) => t.sourceFile));
  const writeFiles = new Set(writeTools.map((t) => t.sourceFile));
  const sharedFiles = [...readFiles].filter((f) => writeFiles.has(f));
  const fileSeparation =
    sharedFiles.length === 0 && readFiles.size > 0 && writeFiles.size > 0;

  // Namespace separation: do read and write tools use distinct prefixes?
  // Check whether tool names have a prefix (dot, colon, or underscore delimited)
  // and whether the prefix sets for read and write are disjoint.
  const readPrefixes = new Set(
    readTools.map((t) => extractPrefix(t.name)).filter((p): p is string => p !== null)
  );
  const writePrefixes = new Set(
    writeTools.map((t) => extractPrefix(t.name)).filter((p): p is string => p !== null)
  );
  const prefixOverlap = [...readPrefixes].filter((p) => writePrefixes.has(p));
  const namespaceSeparation =
    readPrefixes.size > 0 &&
    writePrefixes.size > 0 &&
    prefixOverlap.length === 0;

  if (fileSeparation || namespaceSeparation) return "Present";

  // Clear shared home for both: single file or identical prefix sets
  if (sharedFiles.length === readFiles.size && sharedFiles.length === writeFiles.size) {
    return "Absent";
  }

  // Mixed -- some separation but not clean
  return "Indeterminate";
}

function extractPrefix(toolName: string): string | null {
  // Match prefix.suffix, prefix:suffix, or prefix_suffix (only if suffix
  // contains another delimiter or a verb-like token)
  const dotColon = toolName.match(/^([a-z0-9]+)[.:]/i);
  if (dotColon) return dotColon[1].toLowerCase();

  // Underscore prefix only counts if it's clearly a namespace
  // (e.g., "admin_delete_user" -- first token is a category, not the verb)
  const underscore = toolName.match(/^([a-z]+)_/i);
  if (underscore) {
    const prefix = underscore[1].toLowerCase();
    // Known namespace-like prefixes
    const NAMESPACE_PREFIXES = new Set([
      "admin", "user", "system", "public", "private",
      "internal", "external", "read", "write", "mutation",
      "query", "command", "event",
    ]);
    if (NAMESPACE_PREFIXES.has(prefix)) return prefix;
  }

  return null;
}

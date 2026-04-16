/**
 * Core types for MCP server audit analysis.
 */

export interface McpServerInput {
  /** GitHub clone URL or local path to a cloned repo */
  source: string;
  /** Optional display name (defaults to repo name) */
  name?: string;
}

export interface DiscoveredServer {
  /** GitHub clone URL */
  source: string;
  /** Repository display name (owner/repo) */
  name: string;
  /** Full GitHub URL */
  url: string;
  /** GitHub star count at discovery time */
  stars: number;
  /** ISO date of last push */
  lastUpdated: string;
  /** Primary language reported by GitHub */
  language: string;
  /** Repo description from GitHub */
  description: string;
  /** Where this candidate was found */
  discoveredFrom: "curated-list" | "github-search" | "manual";
}

export interface CandidateFile {
  /** When the candidate list was generated */
  generatedAt: string;
  /** Schema version */
  schemaVersion: "0.1.0";
  /** Filter criteria used during discovery */
  filters: DiscoveryFilters;
  /** Discovered servers */
  candidates: DiscoveredServer[];
}

export interface DiscoveryFilters {
  /** Minimum GitHub stars */
  minStars: number;
  /** Only repos updated after this ISO date */
  updatedAfter?: string;
  /** Filter to specific languages */
  languages?: string[];
  /** Exclude repos matching these patterns */
  exclude?: string[];
}

export interface ExtractedTool {
  /** Tool name as registered in the MCP server */
  name: string;
  /** Tool description from the server definition */
  description: string;
  /** Read or write classification */
  classification: "read" | "write" | "unknown";
  /** Keywords that triggered sensitivity flags */
  sensitiveKeywords: string[];
  /** File path where the tool was defined */
  sourceFile: string;
  /** Line number of the definition */
  sourceLine: number;
}

export interface PatternMatch {
  /** Type of pattern detected */
  type: "auth" | "logging" | "gate" | "attribution" | "rateLimit" | "leastPrivilege" | "stagedExecution";
  /** The matched text or identifier */
  match: string;
  /** File where the pattern was found */
  file: string;
  /** Line number */
  line: number;
}

export type AccountabilityGapPattern =
  | "ungated-write"
  | "auth-without-actor-logging"
  | "global-auth-over-sensitive-tools"
  | "logging-without-attribution"
  | "destructive-without-audit-trail";

export interface AccountabilityGap {
  /** Named pattern this gap represents */
  pattern: AccountabilityGapPattern;
  /** Confidence in the detection based on heuristic quality */
  confidence: "high" | "medium" | "low";
  /** Specific instances where this gap was detected */
  instances: Array<{ tool?: string; file: string; line: number }>;
  /** What the human reviewer needs to verify */
  reviewNote: string;
}

export interface ServerReport {
  /** Server name (derived from repo or provided) */
  name: string;
  /** Source URL or path */
  source: string;
  /** Primary language detected */
  language: "typescript" | "python" | "javascript" | "unknown";
  /** Extracted tool definitions */
  tools: ExtractedTool[];
  /** Count of tools classified as sensitive (write) */
  sensitiveToolCount: number;
  /** Pattern matches found in source */
  patterns: {
    auth: PatternMatch[];
    logging: PatternMatch[];
    gates: PatternMatch[];
    stagedExecution: PatternMatch[];
    actorAttribution: PatternMatch[];
    rateLimit: PatternMatch[];
    leastPrivilege: PatternMatch[];
  };
  /** Summary flags for quick review */
  flags: {
    hasAuth: boolean;
    hasPerToolAuth: boolean;
    hasLogging: boolean;
    /** Whether any principal identifiers (user_id, session_id, etc.) exist in the codebase */
    hasAttributionIdentifiers: boolean;
    /** Whether log statements carry principal identifiers (stricter: log-adjacent) */
    hasAttributedLogging: boolean;
    hasConfirmationGates: boolean;
    hasStagedExecution: boolean;
    hasWriteTools: boolean;
    hasRateLimiting: boolean;
    hasLeastPrivilege: boolean;
  };
  /** Three-valued coding indicators (Present / Absent / Indeterminate) */
  indicators: CodingIndicators;
  /** Named accountability gap patterns detected */
  accountabilityGaps: AccountabilityGap[];
  /** Errors or warnings during extraction */
  warnings: string[];
}

export type IndicatorValue = "Present" | "Absent" | "Indeterminate";

export interface CodingIndicators {
  /** Authentication mechanism exists */
  authentication: IndicatorValue;
  /** Auth is applied per-tool rather than globally */
  perToolAuth: IndicatorValue;
  /** Read/write separation in tool design */
  readWriteSeparation: IndicatorValue;
  /** Least privilege scoping (OAuth scopes, permission sets, capability restrictions) */
  leastPrivilege: IndicatorValue;
  /** Confirmation gates: explicit approval flow before execution */
  confirmationGates: IndicatorValue;
  /** Staged/reversible execution: dry-run, preview, sandbox, undo */
  stagedExecution: IndicatorValue;
  /** Audit logging present */
  auditLogging: IndicatorValue;
  /** Logging carries actor attribution (user_id, session_id near log calls) */
  actorAttribution: IndicatorValue;
  /** Rate limiting or throttling */
  rateLimiting: IndicatorValue;
  /** Sensitive capability isolation via file or namespace structure */
  sensitiveCapabilityIsolation: IndicatorValue;
}

export interface AuditReport {
  /** When the audit was generated */
  generatedAt: string;
  /** Schema version for forward compatibility */
  schemaVersion: "0.1.0";
  /** Individual server reports */
  servers: ServerReport[];
  /** Aggregate statistics */
  summary: {
    totalServers: number;
    totalTools: number;
    totalSensitiveTools: number;
    serversWithAuth: number;
    serversWithLogging: number;
    serversWithGates: number;
  };
}

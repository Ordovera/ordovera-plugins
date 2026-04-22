/**
 * Core types for MCP server audit analysis.
 */

export interface McpServerInput {
  /** GitHub clone URL or local path to a cloned repo */
  source: string;
  /** Optional display name (defaults to repo name) */
  name?: string;
}

export interface AnalyzeOptions {
  /**
   * When true and Layer C detects a wrapper, attempt runtime extraction:
   * npm install --ignore-scripts in the clone, then introspect the upstream
   * package for exported tool definitions.
   */
  deepExtract?: boolean;
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

export interface TestToolCoverage {
  /** Tool names asserted in test files */
  names: string[];
  /** File where the tool names were found */
  sourceFile: string;
  /** Cross-check between extraction and test assertions */
  coverage: {
    /** Tools found by extraction */
    extractedCount: number;
    /** Tool names asserted in tests */
    assertedCount: number;
    /** Tool names in tests but not found by extraction */
    missingFromExtraction: string[];
    /** Extracted tools not mentioned in tests */
    missingFromTests: string[];
  };
}

export interface EvidenceSourceInfo {
  tool: "cc-mcp-audit";
  version: string;
  commitHash: string | null;
}

export interface ServerReport {
  /** Server name (derived from repo or provided) */
  name: string;
  /** Source URL or path */
  source: string;
  /**
   * Git commit hash of the analyzed source, if available.
   * Captured at analysis time from the cloned or local repo. Null when the
   * source is not a git repository or the hash could not be read.
   */
  commitHash: string | null;
  /** Primary language detected */
  language: "typescript" | "python" | "javascript" | "unknown";
  /**
   * Upstream package this server wraps, if detected.
   * Present when the extractor finds 0 tools but identifies the repo as a
   * thin wrapper around a dependency that likely contains the tool definitions.
   */
  upstreamPackage: string | null;
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
  /**
   * Optional LLM-generated triage hints for Domain 5 indicators.
   * Present only when --llm-screen was enabled. These are hints for the human
   * reviewer, never coded values -- coding values live in `indicators`.
   */
  screeningSignals?: Partial<Record<Domain5Indicator, ScreeningSignal>>;
  /** Optional screening run metadata (model, tokens, cost) */
  screeningMetadata?: ScreeningMetadata;
  /**
   * Test-file tool name cross-check. Present when test files contain tool name
   * assertions, providing a governance signal about extraction completeness.
   */
  testToolCoverage?: TestToolCoverage[];
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
  /** Domain 5: coded by human review. Null until populated. */
  selfModificationPrevention: IndicatorValue | null;
  /** Domain 5: coded by human review. Null until populated. */
  subAgentAuthorityConstraints: IndicatorValue | null;
  /** Domain 5: coded by human review. Null until populated. */
  permissionBoundaryEnforcement: IndicatorValue | null;
}

export type Domain5Indicator =
  | "selfModificationPrevention"
  | "subAgentAuthorityConstraints"
  | "permissionBoundaryEnforcement";

export type ScreeningLikelihood = "likely-present" | "likely-absent" | "unclear";

export interface ScreeningSignal {
  likelihood: ScreeningLikelihood;
  notes: string;
  citations: Array<{ file: string; line: number }>;
}

export interface ScreeningMetadata {
  model: string;
  promptVersion: string;
  totalTokens: number;
  estimatedCostUsd: number;
  indicatorsScreened: Domain5Indicator[];
}

export interface EvidenceEnvelope {
  /** Evidence format version */
  evidenceVersion: "0.1.0";
  /** Evidence source identifier */
  source: EvidenceSourceInfo;
  /** When this Evidence was produced */
  timestamp: string;
  /** The MCP server being assessed (XACML subject) */
  subject: {
    name: string;
    source: string;
    commitHash: string | null;
    language: string;
  };
  /** Governance-posture attributes (XACML resource attributes) */
  attributes: {
    indicators: CodingIndicators;
    gaps: AccountabilityGap[];
    flags: ServerReport["flags"];
    toolSummary: {
      total: number;
      read: number;
      write: number;
      unknown: number;
      sensitive: number;
    };
  };
  /** Full ServerReport for deep inspection (audit trail) */
  fullReport: ServerReport;
}

export interface EvidenceBatch {
  evidenceVersion: "0.1.0";
  generatedAt: string;
  source: EvidenceEnvelope["source"];
  envelopes: EvidenceEnvelope[];
  summary: AuditReport["summary"];
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

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
  type: "auth" | "logging" | "gate";
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
    actorAttribution: PatternMatch[];
  };
  /** Summary flags for quick review */
  flags: {
    hasAuth: boolean;
    hasPerToolAuth: boolean;
    hasLogging: boolean;
    hasActorAttribution: boolean;
    hasConfirmationGates: boolean;
    hasWriteTools: boolean;
  };
  /** Named accountability gap patterns detected */
  accountabilityGaps: AccountabilityGap[];
  /** Errors or warnings during extraction */
  warnings: string[];
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

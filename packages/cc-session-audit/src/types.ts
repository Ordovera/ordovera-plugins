/**
 * Types for Claude Code session JSONL parsing and audit reporting.
 */

// -- JSONL message types --

export interface SessionMessage {
  type: "user" | "assistant" | "progress" | "system" | "file-history-snapshot" | "last-prompt" | "queue-operation";
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  userType?: string;
  isSidechain?: boolean;
  message?: UserContent | AssistantContent | string;
  // progress-specific
  data?: ProgressData;
  toolUseID?: string;
  // system-specific
  subtype?: string;
  // file-history-snapshot-specific
  snapshot?: Record<string, unknown>;
}

export interface UserContent {
  role: "user";
  content: ContentBlock[] | string;
}

export interface AssistantContent {
  role: "assistant";
  model?: string;
  id?: string;
  content: ContentBlock[];
  stop_reason?: string;
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller?: string;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlock[];
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ProgressData {
  type: string;
  hookEvent?: string;
  hookName?: string;
  command?: string;
}

// -- Policy types --

export interface PolicyFile {
  approved_tools?: string[];
  denied_tools?: string[];
  approved_mcp_servers?: string[];
  denied_mcp_servers?: string[];
  restricted_paths?: string[];
  max_autonomous_turns?: number;
}

export interface PolicyViolation {
  rule: string;
  detail: string;
  timestamp?: string;
  tool?: string;
}

// -- Report types --

export interface ToolInvocation {
  name: string;
  count: number;
  is_mcp: boolean;
}

export interface FileModification {
  path: string;
  tool: string;
  timestamp: string;
}

export interface AuditReport {
  session_file: string;
  session_id: string | null;
  timestamp_range: {
    start: string | null;
    end: string | null;
  };
  message_counts: {
    user: number;
    assistant: number;
    tool_use: number;
    tool_result: number;
    progress: number;
    system: number;
  };
  tool_inventory: ToolInvocation[];
  mcp_servers: string[];
  interaction_ratio: {
    human_turns: number;
    autonomous_turns: number;
    ratio: string;
  };
  file_modifications: FileModification[];
  policy_violations: PolicyViolation[];
  compaction_events: number;
}

/**
 * Session analyzer -- extracts governance-relevant signals from parsed
 * session messages and produces an AuditReport.
 */

import type {
  AuditReport,
  AssistantContent,
  ContentBlock,
  FileModification,
  PolicyFile,
  PolicyViolation,
  SessionMessage,
  ToolInvocation,
  ToolUseBlock,
  UserContent,
} from "./types.js";

interface AnalyzerState {
  sessionId: string | null;
  timestamps: string[];
  userTurns: number;
  assistantTurns: number;
  toolUseCount: number;
  toolResultCount: number;
  progressCount: number;
  systemCount: number;
  toolCounts: Map<string, number>;
  mcpServers: Set<string>;
  fileModifications: FileModification[];
  compactionEvents: number;
  autonomousRunLength: number;
  maxAutonomousRun: number;
  policyViolations: PolicyViolation[];
}

function isAssistantContent(msg: unknown): msg is AssistantContent {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).role === "assistant" &&
    Array.isArray((msg as Record<string, unknown>).content)
  );
}

function isUserContent(msg: unknown): msg is UserContent {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).role === "user"
  );
}

function extractToolUseBlocks(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter(
    (b): b is ToolUseBlock => typeof b === "object" && b.type === "tool_use"
  );
}

function isHumanTextTurn(msg: SessionMessage): boolean {
  if (msg.type !== "user") return false;
  const content = msg.message;
  if (typeof content === "string") return true;
  if (!isUserContent(content)) return false;
  if (typeof content.content === "string") return true;
  if (Array.isArray(content.content)) {
    return content.content.some(
      (b) => typeof b === "object" && b.type === "text"
    );
  }
  return false;
}

function extractMcpServer(toolName: string): string | null {
  // MCP tools follow the pattern mcp__<server>__<tool>
  if (!toolName.startsWith("mcp__")) return null;
  const parts = toolName.split("__");
  return parts.length >= 2 ? parts[1] : null;
}

const FILE_MUTATING_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

function extractFileModifications(
  tool: ToolUseBlock,
  timestamp: string
): FileModification | null {
  if (FILE_MUTATING_TOOLS.has(tool.name)) {
    const path =
      (tool.input.file_path as string) ??
      (tool.input.path as string) ??
      "unknown";
    return { path, tool: tool.name, timestamp };
  }
  // Bash commands that write files are harder to detect reliably;
  // only flag explicit redirects as a best-effort signal
  if (tool.name === "Bash") {
    const cmd = (tool.input.command as string) ?? "";
    if (cmd.includes(" > ") || cmd.includes(" >> ") || cmd.includes("tee ")) {
      return { path: "(bash output)", tool: "Bash", timestamp };
    }
  }
  return null;
}

function checkPolicyViolations(
  tool: ToolUseBlock,
  policy: PolicyFile,
  timestamp: string
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  // Denied tools
  if (policy.denied_tools?.includes(tool.name)) {
    violations.push({
      rule: "denied_tool",
      detail: `Tool "${tool.name}" is on the deny list`,
      timestamp,
      tool: tool.name,
    });
  }

  // Approved tools (allowlist mode)
  if (
    policy.approved_tools &&
    policy.approved_tools.length > 0 &&
    !policy.approved_tools.includes(tool.name)
  ) {
    violations.push({
      rule: "unapproved_tool",
      detail: `Tool "${tool.name}" is not on the approved list`,
      timestamp,
      tool: tool.name,
    });
  }

  // MCP server checks
  const server = extractMcpServer(tool.name);
  if (server) {
    if (policy.denied_mcp_servers?.includes(server)) {
      violations.push({
        rule: "denied_mcp_server",
        detail: `MCP server "${server}" is on the deny list`,
        timestamp,
        tool: tool.name,
      });
    }
    if (
      policy.approved_mcp_servers &&
      policy.approved_mcp_servers.length > 0 &&
      !policy.approved_mcp_servers.includes(server)
    ) {
      violations.push({
        rule: "unapproved_mcp_server",
        detail: `MCP server "${server}" is not on the approved list`,
        timestamp,
        tool: tool.name,
      });
    }
  }

  // Restricted paths
  if (policy.restricted_paths && policy.restricted_paths.length > 0) {
    const filePath =
      (tool.input.file_path as string) ??
      (tool.input.path as string) ??
      "";
    if (filePath) {
      for (const restricted of policy.restricted_paths) {
        if (filePath.startsWith(restricted) || filePath.includes(restricted)) {
          violations.push({
            rule: "restricted_path",
            detail: `Access to restricted path "${restricted}" via "${tool.name}" on "${filePath}"`,
            timestamp,
            tool: tool.name,
          });
        }
      }
    }
  }

  return violations;
}

export function analyzeSession(
  messages: SessionMessage[],
  sessionFile: string,
  policy?: PolicyFile
): AuditReport {
  const state: AnalyzerState = {
    sessionId: null,
    timestamps: [],
    userTurns: 0,
    assistantTurns: 0,
    toolUseCount: 0,
    toolResultCount: 0,
    progressCount: 0,
    systemCount: 0,
    toolCounts: new Map(),
    mcpServers: new Set(),
    fileModifications: [],
    compactionEvents: 0,
    autonomousRunLength: 0,
    maxAutonomousRun: 0,
    policyViolations: [],
  };

  for (const msg of messages) {
    // Track session ID from first message that has one
    if (!state.sessionId && msg.sessionId) {
      state.sessionId = msg.sessionId;
    }

    // Track timestamps
    if (msg.timestamp) {
      state.timestamps.push(msg.timestamp);
    }

    switch (msg.type) {
      case "user": {
        if (isHumanTextTurn(msg)) {
          state.userTurns++;
          // Reset autonomous run counter on human input
          if (state.autonomousRunLength > state.maxAutonomousRun) {
            state.maxAutonomousRun = state.autonomousRunLength;
          }
          state.autonomousRunLength = 0;
        }
        // Count tool results
        const userContent = msg.message;
        if (isUserContent(userContent) && Array.isArray(userContent.content)) {
          for (const block of userContent.content) {
            if (typeof block === "object" && block.type === "tool_result") {
              state.toolResultCount++;
            }
          }
        }
        break;
      }

      case "assistant": {
        state.assistantTurns++;
        state.autonomousRunLength++;

        const assistantContent = msg.message;
        if (isAssistantContent(assistantContent)) {
          const toolUses = extractToolUseBlocks(assistantContent.content);
          state.toolUseCount += toolUses.length;

          for (const tool of toolUses) {
            // Count tool usage
            const prev = state.toolCounts.get(tool.name) ?? 0;
            state.toolCounts.set(tool.name, prev + 1);

            // Track MCP servers
            const server = extractMcpServer(tool.name);
            if (server) {
              state.mcpServers.add(server);
            }

            // Track file modifications
            const mod = extractFileModifications(tool, msg.timestamp ?? "");
            if (mod) {
              state.fileModifications.push(mod);
            }

            // Check policy
            if (policy) {
              const violations = checkPolicyViolations(
                tool,
                policy,
                msg.timestamp ?? ""
              );
              state.policyViolations.push(...violations);
            }
          }
        }
        break;
      }

      case "progress":
        state.progressCount++;
        break;

      case "system": {
        state.systemCount++;
        // Detect compaction events
        if (msg.subtype === "compact" || msg.subtype === "compaction") {
          state.compactionEvents++;
        }
        break;
      }
    }
  }

  // Final autonomous run check
  if (state.autonomousRunLength > state.maxAutonomousRun) {
    state.maxAutonomousRun = state.autonomousRunLength;
  }

  // Check max autonomous turns policy
  if (
    policy?.max_autonomous_turns &&
    state.maxAutonomousRun > policy.max_autonomous_turns
  ) {
    state.policyViolations.push({
      rule: "max_autonomous_turns",
      detail: `Longest autonomous run was ${state.maxAutonomousRun} turns (limit: ${policy.max_autonomous_turns})`,
    });
  }

  // Build tool inventory
  const toolInventory: ToolInvocation[] = Array.from(state.toolCounts.entries())
    .map(([name, count]) => ({
      name,
      count,
      is_mcp: name.startsWith("mcp__"),
    }))
    .sort((a, b) => b.count - a.count);

  // Compute interaction ratio
  const totalTurns = state.userTurns + state.assistantTurns;
  const ratioStr =
    totalTurns > 0
      ? `${state.userTurns}:${state.assistantTurns} (human:autonomous)`
      : "0:0";

  // Timestamp range
  const sorted = state.timestamps.sort();

  return {
    session_file: sessionFile,
    session_id: state.sessionId,
    timestamp_range: {
      start: sorted[0] ?? null,
      end: sorted[sorted.length - 1] ?? null,
    },
    message_counts: {
      user: state.userTurns,
      assistant: state.assistantTurns,
      tool_use: state.toolUseCount,
      tool_result: state.toolResultCount,
      progress: state.progressCount,
      system: state.systemCount,
    },
    tool_inventory: toolInventory,
    mcp_servers: Array.from(state.mcpServers).sort(),
    interaction_ratio: {
      human_turns: state.userTurns,
      autonomous_turns: state.assistantTurns,
      ratio: ratioStr,
    },
    file_modifications: state.fileModifications,
    policy_violations: state.policyViolations,
    compaction_events: state.compactionEvents,
  };
}

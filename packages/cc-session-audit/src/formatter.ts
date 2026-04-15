/**
 * Terminal output formatter for audit reports.
 */

import type { AuditReport } from "./types.js";

function header(text: string): string {
  return `\n${text}\n${"=".repeat(text.length)}`;
}

function subheader(text: string): string {
  return `\n${text}\n${"-".repeat(text.length)}`;
}

function padRight(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

export function formatTerminal(report: AuditReport): string {
  const lines: string[] = [];

  // Header
  lines.push(header("Session Audit Report"));
  lines.push(`Session: ${report.session_id ?? "unknown"}`);
  lines.push(`File: ${report.session_file}`);
  if (report.timestamp_range.start && report.timestamp_range.end) {
    lines.push(
      `Time range: ${report.timestamp_range.start} to ${report.timestamp_range.end}`
    );
  }

  // Message counts
  lines.push(subheader("Message Counts"));
  lines.push(`  Human turns:     ${report.message_counts.user}`);
  lines.push(`  Assistant turns:  ${report.message_counts.assistant}`);
  lines.push(`  Tool uses:        ${report.message_counts.tool_use}`);
  lines.push(`  Tool results:     ${report.message_counts.tool_result}`);
  lines.push(`  Progress events:  ${report.message_counts.progress}`);
  lines.push(`  System events:    ${report.message_counts.system}`);

  // Interaction ratio
  lines.push(subheader("Interaction Ratio"));
  lines.push(`  ${report.interaction_ratio.ratio}`);
  if (report.compaction_events > 0) {
    lines.push(
      `  Compaction events: ${report.compaction_events} (some context may have been lost)`
    );
  }

  // Tool inventory
  if (report.tool_inventory.length > 0) {
    lines.push(subheader("Tool Inventory"));
    const nameWidth = Math.max(
      ...report.tool_inventory.map((t) => t.name.length),
      4
    );
    lines.push(
      `  ${padRight("Tool", nameWidth)}  Count  Type`
    );
    lines.push(
      `  ${"-".repeat(nameWidth)}  -----  ----`
    );
    for (const tool of report.tool_inventory) {
      const type = tool.is_mcp ? "MCP" : "built-in";
      lines.push(
        `  ${padRight(tool.name, nameWidth)}  ${String(tool.count).padStart(5)}  ${type}`
      );
    }
  }

  // MCP servers
  if (report.mcp_servers.length > 0) {
    lines.push(subheader("MCP Servers Active"));
    for (const server of report.mcp_servers) {
      lines.push(`  - ${server}`);
    }
  }

  // File modifications
  if (report.file_modifications.length > 0) {
    lines.push(subheader("File Modifications"));
    // Deduplicate by path for the summary
    const byPath = new Map<string, { tools: Set<string>; count: number }>();
    for (const mod of report.file_modifications) {
      const entry = byPath.get(mod.path) ?? { tools: new Set(), count: 0 };
      entry.tools.add(mod.tool);
      entry.count++;
      byPath.set(mod.path, entry);
    }
    for (const [path, info] of byPath) {
      const tools = Array.from(info.tools).join(", ");
      lines.push(`  ${path} (${info.count}x via ${tools})`);
    }
  }

  // Policy violations
  if (report.policy_violations.length > 0) {
    lines.push(subheader("POLICY VIOLATIONS"));
    for (const v of report.policy_violations) {
      const ts = v.timestamp ? ` [${v.timestamp}]` : "";
      lines.push(`  [${v.rule}] ${v.detail}${ts}`);
    }
    lines.push(
      `\n  Total violations: ${report.policy_violations.length}`
    );
  } else {
    lines.push(subheader("Policy"));
    lines.push("  No violations detected.");
  }

  lines.push("");
  return lines.join("\n");
}

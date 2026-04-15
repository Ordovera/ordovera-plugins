import type {
  ServerReport,
  AuditReport,
  ExtractedTool,
} from "./types.js";
import type { PatternResults } from "./patterns.js";

/**
 * Build a ServerReport from extraction and pattern scan results.
 */
export function buildServerReport(
  name: string,
  source: string,
  language: ServerReport["language"],
  tools: ExtractedTool[],
  patterns: PatternResults,
  warnings: string[]
): ServerReport {
  const sensitiveToolCount = tools.filter(
    (t) => t.classification === "write"
  ).length;

  return {
    name,
    source,
    language,
    tools,
    sensitiveToolCount,
    patterns,
    flags: {
      hasAuth: patterns.auth.length > 0,
      hasPerToolAuth: false, // Set by caller after assessAuthArchitecture
      hasLogging: patterns.logging.length > 0,
      hasConfirmationGates: patterns.gates.length > 0,
      hasWriteTools: sensitiveToolCount > 0,
    },
    warnings,
  };
}

/**
 * Build the aggregate AuditReport from individual server reports.
 */
export function buildAuditReport(
  servers: ServerReport[]
): AuditReport {
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: "0.1.0",
    servers,
    summary: {
      totalServers: servers.length,
      totalTools: servers.reduce((sum, s) => sum + s.tools.length, 0),
      totalSensitiveTools: servers.reduce(
        (sum, s) => sum + s.sensitiveToolCount,
        0
      ),
      serversWithAuth: servers.filter((s) => s.flags.hasAuth).length,
      serversWithLogging: servers.filter((s) => s.flags.hasLogging).length,
      serversWithGates: servers.filter(
        (s) => s.flags.hasConfirmationGates
      ).length,
    },
  };
}

/**
 * Format an AuditReport as human-readable markdown.
 */
export function formatMarkdown(report: AuditReport): string {
  const lines: string[] = [];

  lines.push("# MCP Server Audit Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Servers analyzed: ${report.summary.totalServers}`);
  lines.push(`- Total tools: ${report.summary.totalTools}`);
  lines.push(
    `- Sensitive (write) tools: ${report.summary.totalSensitiveTools}`
  );
  lines.push(`- Servers with auth: ${report.summary.serversWithAuth}`);
  lines.push(
    `- Servers with logging: ${report.summary.serversWithLogging}`
  );
  lines.push(
    `- Servers with confirmation gates: ${report.summary.serversWithGates}`
  );
  lines.push("");

  // Per-server details
  for (const server of report.servers) {
    lines.push(`## ${server.name}`);
    lines.push("");
    lines.push(`Source: ${server.source}`);
    lines.push(`Language: ${server.language}`);
    lines.push("");

    // Tool inventory table
    lines.push("### Tool Inventory");
    lines.push("");
    lines.push(
      "| Tool | Classification | Sensitive Keywords |"
    );
    lines.push("|------|---------------|-------------------|");
    for (const tool of server.tools) {
      lines.push(
        `| ${tool.name} | ${tool.classification} | ${tool.sensitiveKeywords.join(", ") || "none"} |`
      );
    }
    lines.push("");
    lines.push(
      `Sensitive tools: ${server.sensitiveToolCount} of ${server.tools.length}`
    );
    lines.push("");

    // Pattern flags
    lines.push("### Pattern Flags");
    lines.push("");
    lines.push(
      `- [${server.flags.hasAuth ? "X" : " "}] Authentication detected (${server.patterns.auth.length} occurrences)`
    );
    lines.push(
      `- [${server.flags.hasPerToolAuth ? "X" : " "}] Per-tool authorization`
    );
    lines.push(
      `- [${server.flags.hasLogging ? "X" : " "}] Logging/audit trail (${server.patterns.logging.length} occurrences)`
    );
    lines.push(
      `- [${server.flags.hasConfirmationGates ? "X" : " "}] Confirmation gates (${server.patterns.gates.length} occurrences)`
    );
    lines.push(
      `- [${server.flags.hasWriteTools ? "X" : " "}] Write/modify tools present`
    );
    lines.push("");

    // Warnings
    if (server.warnings.length > 0) {
      lines.push("### Warnings");
      lines.push("");
      for (const w of server.warnings) {
        lines.push(`- ${w}`);
      }
      lines.push("");
    }

    // Human review section
    lines.push("### Human Review Required");
    lines.push("");
    lines.push(
      "- [ ] Confirm authorization architecture (global vs per-tool)"
    );
    if (server.flags.hasWriteTools) {
      lines.push(
        "- [ ] Assess guardrails on write operations"
      );
    }
    lines.push("- [ ] Determine accountability implications");
    if (!server.flags.hasConfirmationGates && server.flags.hasWriteTools) {
      lines.push(
        "- [ ] Evaluate absence of confirmation gates for write tools"
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

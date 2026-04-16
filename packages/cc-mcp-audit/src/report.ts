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
  warnings: string[],
  commitHash: string | null = null
): ServerReport {
  const sensitiveToolCount = tools.filter(
    (t) => t.classification === "write"
  ).length;

  return {
    name,
    source,
    commitHash,
    language,
    tools,
    sensitiveToolCount,
    patterns,
    flags: {
      hasAuth: patterns.auth.length > 0,
      hasPerToolAuth: false, // Set by caller after assessAuthArchitecture
      hasLogging: patterns.logging.length > 0,
      hasAttributionIdentifiers: false, // Set by caller
      hasAttributedLogging: false, // Set by caller after hasLogAdjacentAttribution
      hasConfirmationGates: patterns.gates.length > 0,
      hasStagedExecution: patterns.stagedExecution.length > 0,
      hasWriteTools: sensitiveToolCount > 0,
      hasRateLimiting: patterns.rateLimit.length > 0,
      hasLeastPrivilege: patterns.leastPrivilege.length > 0,
    },
    indicators: {
      authentication: "Absent",
      perToolAuth: "Absent",
      readWriteSeparation: "Absent",
      leastPrivilege: "Absent",
      confirmationGates: "Absent",
      auditLogging: "Absent",
      stagedExecution: "Absent",
      actorAttribution: "Absent",
      rateLimiting: "Absent",
      sensitiveCapabilityIsolation: "Absent",
      selfModificationPrevention: null,
      subAgentAuthorityConstraints: null,
      permissionBoundaryEnforcement: null,
    }, // Set by caller after deriveIndicators
    accountabilityGaps: [], // Set by caller after detectGaps
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

  // Comparison table for multi-server reports
  if (report.servers.length > 1) {
    lines.push(...formatComparisonTable(report.servers));
    lines.push("");
  }

  // Per-server details
  for (const server of report.servers) {
    lines.push(...formatServerSection(server));
  }

  return lines.join("\n");
}

function formatComparisonTable(servers: ServerReport[]): string[] {
  const lines: string[] = [];

  lines.push("## Accountability Comparison");
  lines.push("");
  lines.push(
    "| Server | Write Tools | Auth | Attr. Logs | Gates | Rate Limit | Least Priv. | Gaps |"
  );
  lines.push(
    "|--------|-------------|------|------------|-------|------------|-------------|------|"
  );

  for (const s of servers) {
    const writeCount = `${s.sensitiveToolCount}/${s.tools.length}`;
    const auth = s.flags.hasPerToolAuth
      ? "per-tool"
      : s.flags.hasAuth
        ? "global"
        : "none";
    const attribution = s.flags.hasAttributedLogging ? "yes" : "no";
    const gates = s.flags.hasConfirmationGates ? "yes" : "no";
    const rateLimit = s.flags.hasRateLimiting ? "yes" : "no";
    const leastPriv = s.flags.hasLeastPrivilege ? "yes" : "no";
    const gapNames = s.accountabilityGaps.length > 0
      ? s.accountabilityGaps.map((g) => abbreviateGap(g.pattern, g.confidence)).join(", ")
      : "-";

    lines.push(
      `| ${s.name} | ${writeCount} | ${auth} | ${attribution} | ${gates} | ${rateLimit} | ${leastPriv} | ${gapNames} |`
    );
  }

  lines.push("");

  // Gap pattern frequency across servers
  const gapCounts = new Map<string, number>();
  for (const s of servers) {
    for (const gap of s.accountabilityGaps) {
      gapCounts.set(gap.pattern, (gapCounts.get(gap.pattern) ?? 0) + 1);
    }
  }

  if (gapCounts.size > 0) {
    lines.push("### Gap Patterns Across Servers");
    lines.push("");
    for (const [pattern, count] of [...gapCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(
        `- **${pattern}**: ${count} of ${servers.length} servers`
      );
    }
    lines.push("");
  }

  return lines;
}

function formatServerSection(server: ServerReport): string[] {
  const lines: string[] = [];

  lines.push(`## ${server.name}`);
  lines.push("");
  lines.push(`Source: ${server.source}`);
  lines.push(`Language: ${server.language}`);
  if (server.commitHash) {
    lines.push(`Commit: ${server.commitHash.slice(0, 12)}`);
  }
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

  // Coding indicators (three-valued: Present / Absent / Indeterminate)
  lines.push("### Coding Indicators");
  lines.push("");
  lines.push("| Indicator | Value |");
  lines.push("|-----------|-------|");
  const ind = server.indicators;
  lines.push(`| Authentication | ${ind.authentication} |`);
  lines.push(`| Per-tool authorization | ${ind.perToolAuth} |`);
  lines.push(`| Read/write separation | ${ind.readWriteSeparation} |`);
  lines.push(`| Least privilege scoping | ${ind.leastPrivilege} |`);
  lines.push(`| Confirmation gates | ${ind.confirmationGates} |`);
  lines.push(`| Staged/reversible execution | ${ind.stagedExecution} |`);
  lines.push(`| Audit logging | ${ind.auditLogging} |`);
  lines.push(`| Actor attribution | ${ind.actorAttribution} |`);
  lines.push(`| Rate limiting | ${ind.rateLimiting} |`);
  lines.push(`| Sensitive capability isolation | ${ind.sensitiveCapabilityIsolation} |`);
  lines.push(`| Self-modification prevention (Domain 5) | ${ind.selfModificationPrevention ?? "(human review required)"} |`);
  lines.push(`| Sub-agent authority constraints (Domain 5) | ${ind.subAgentAuthorityConstraints ?? "(human review required)"} |`);
  lines.push(`| Permission boundary enforcement (Domain 5) | ${ind.permissionBoundaryEnforcement ?? "(human review required)"} |`);
  lines.push("");

  // LLM screening hints for Domain 5 (optional)
  if (server.screeningSignals) {
    lines.push("### Human Review Required (Domain 5)");
    lines.push("");
    const s = server.screeningSignals;
    lines.push(...formatScreeningHint("Self-modification prevention", s.selfModificationPrevention));
    lines.push(...formatScreeningHint("Sub-agent authority constraints", s.subAgentAuthorityConstraints));
    lines.push(...formatScreeningHint("Permission boundary enforcement", s.permissionBoundaryEnforcement));
    lines.push("");
    if (server.screeningMetadata) {
      const m = server.screeningMetadata;
      const costDisplay = m.estimatedCostUsd > 0 ? ` | ~$${m.estimatedCostUsd.toFixed(4)}` : "";
      lines.push(
        `Screening: ${m.model} | prompt ${m.promptVersion} | ${m.totalTokens} tokens${costDisplay}`
      );
      lines.push("");
    }
  }

  // Pattern flags
  lines.push("### Pattern Flags");
  lines.push("");
  lines.push(
    `- [${server.flags.hasAuth ? "X" : " "}] Authentication detected (${server.patterns.auth.length} occurrences)`
  );
  lines.push(
    `- [${server.flags.hasPerToolAuth ? "X" : " "}] Per-tool authorization (colocation heuristic)`
  );
  lines.push(
    `- [${server.flags.hasLogging ? "X" : " "}] Logging present (${server.patterns.logging.length} occurrences)`
  );
  lines.push(
    `- [${server.flags.hasAttributedLogging ? "X" : " "}] Actor attribution in logs (${server.patterns.actorAttribution?.length ?? 0} occurrences)`
  );
  lines.push(
    `- [${server.flags.hasConfirmationGates ? "X" : " "}] Confirmation gates (${server.patterns.gates.length} occurrences)`
  );
  lines.push(
    `- [${server.flags.hasStagedExecution ? "X" : " "}] Staged/reversible execution (${server.patterns.stagedExecution.length} occurrences)`
  );
  lines.push(
    `- [${server.flags.hasWriteTools ? "X" : " "}] Write/modify tools present`
  );
  lines.push(
    `- [${server.flags.hasRateLimiting ? "X" : " "}] Rate limiting (${server.patterns.rateLimit.length} occurrences)`
  );
  lines.push(
    `- [${server.flags.hasLeastPrivilege ? "X" : " "}] Least privilege scoping (${server.patterns.leastPrivilege.length} occurrences)`
  );
  lines.push("");

  // Accountability gaps
  if (server.accountabilityGaps.length > 0) {
    lines.push("### Accountability Gaps");
    lines.push("");
    for (const gap of server.accountabilityGaps) {
      const conf = gap.confidence !== "high" ? ` (${gap.confidence} confidence)` : "";
      lines.push(`**${gap.pattern}**${conf}`);
      lines.push("");
      for (const inst of gap.instances) {
        const toolRef = inst.tool ? `${inst.tool} at ` : "";
        lines.push(`- ${toolRef}${inst.file}:${inst.line}`);
      }
      lines.push("");
      lines.push(`Review: ${gap.reviewNote}`);
      lines.push("");
    }
  }

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
  if (!server.flags.hasAttributedLogging && server.flags.hasLogging) {
    lines.push(
      "- [ ] Verify whether logging includes actor attribution not detected by static analysis"
    );
  }
  lines.push("- [ ] Determine accountability implications");
  if (!server.flags.hasConfirmationGates && server.flags.hasWriteTools) {
    lines.push(
      "- [ ] Evaluate absence of confirmation gates for write tools"
    );
  }
  lines.push("");

  return lines;
}

const GAP_ABBREVIATIONS: Record<string, string> = {
  "ungated-write": "UW",
  "auth-without-actor-logging": "AA",
  "global-auth-over-sensitive-tools": "GA",
  "logging-without-attribution": "LA",
  "destructive-without-audit-trail": "DA",
};

function abbreviateGap(pattern: string, confidence: string): string {
  const code = GAP_ABBREVIATIONS[pattern] ?? pattern;
  return confidence === "low" ? `${code}?` : code;
}

function formatScreeningHint(
  label: string,
  signal: { likelihood: string; notes: string; citations: Array<{ file: string; line: number }> } | undefined
): string[] {
  if (!signal) {
    return [`- [ ] ${label} -- no screening signal available`];
  }

  const citationStr =
    signal.citations.length > 0
      ? ` -- ${signal.citations.map((c) => `${c.file}:${c.line}`).join(", ")}`
      : "";

  const hint = `screening hint: ${signal.likelihood}${signal.notes ? ` (${signal.notes})` : ""}${citationStr}`;
  return [`- [ ] ${label} -- ${hint}`];
}

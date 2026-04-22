import { describe, it, expect } from "vitest";
import {
  buildServerReport,
  buildAuditReport,
  formatMarkdown,
} from "./report.js";
import type { ExtractedTool } from "./types.js";
import type { PatternResults } from "./patterns.js";

function makeTools(): ExtractedTool[] {
  return [
    {
      name: "list_items",
      description: "List items",
      classification: "read",
      sensitiveKeywords: [],
      sourceFile: "server.py",
      sourceLine: 10,
    },
    {
      name: "delete_item",
      description: "Delete an item",
      classification: "write",
      sensitiveKeywords: ["delete"],
      sourceFile: "server.py",
      sourceLine: 20,
    },
  ];
}

function makePatterns(): PatternResults {
  return {
    auth: [{ type: "auth", match: "Bearer", file: "auth.py", line: 5 }],
    logging: [
      { type: "logging", match: "logger.info", file: "server.py", line: 12 },
    ],
    gates: [],
    stagedExecution: [],
    actorAttribution: [],
    rateLimit: [],
    leastPrivilege: [],
  };
}

describe("buildServerReport", () => {
  it("builds a complete report", () => {
    const report = buildServerReport(
      "test-server",
      "https://github.com/example/test",
      "python",
      makeTools(),
      makePatterns(),
      []
    );

    expect(report.name).toBe("test-server");
    expect(report.tools).toHaveLength(2);
    expect(report.sensitiveToolCount).toBe(1);
    expect(report.flags.hasAuth).toBe(true);
    expect(report.flags.hasLogging).toBe(true);
    expect(report.flags.hasConfirmationGates).toBe(false);
    expect(report.flags.hasWriteTools).toBe(true);
  });

  it("includes warnings", () => {
    const report = buildServerReport(
      "test",
      "/local",
      "unknown",
      [],
      { auth: [], logging: [], gates: [], stagedExecution: [], actorAttribution: [], rateLimit: [], leastPrivilege: [] },
      ["No tools found"]
    );
    expect(report.warnings).toContain("No tools found");
  });
});

describe("buildAuditReport", () => {
  it("aggregates stats from multiple servers", () => {
    const s1 = buildServerReport(
      "s1", "url1", "python", makeTools(), makePatterns(), []
    );
    const s2 = buildServerReport(
      "s2", "url2", "typescript",
      [makeTools()[0]], // read-only server
      { auth: [], logging: [], gates: [], stagedExecution: [], actorAttribution: [], rateLimit: [], leastPrivilege: [] },
      []
    );

    const report = buildAuditReport([s1, s2]);

    expect(report.schemaVersion).toBe("0.1.0");
    expect(report.summary.totalServers).toBe(2);
    expect(report.summary.totalTools).toBe(3);
    expect(report.summary.totalSensitiveTools).toBe(1);
    expect(report.summary.serversWithAuth).toBe(1);
    expect(report.summary.serversWithLogging).toBe(1);
    expect(report.summary.serversWithGates).toBe(0);
  });
});

describe("formatMarkdown", () => {
  it("produces valid markdown with expected sections", () => {
    const server = buildServerReport(
      "test-server",
      "https://github.com/example/test",
      "python",
      makeTools(),
      makePatterns(),
      ["Some warning"]
    );
    const report = buildAuditReport([server]);
    const md = formatMarkdown(report);

    expect(md).toContain("# MCP Server Audit Report");
    expect(md).toContain("## Summary");
    expect(md).toContain("## test-server");
    expect(md).toContain("### Tool Inventory");
    expect(md).toContain("### Pattern Flags");
    expect(md).toContain("### Warnings");
    expect(md).toContain("Some warning");
    expect(md).toContain("### Human Review Required");
    expect(md).toContain("list_items");
    expect(md).toContain("delete_item");
  });

  it("includes confirmation gate review item when write tools lack gates", () => {
    const server = buildServerReport(
      "ungated",
      "/local",
      "python",
      makeTools(),
      { auth: [], logging: [], gates: [], stagedExecution: [], actorAttribution: [], rateLimit: [], leastPrivilege: [] },
      []
    );
    const report = buildAuditReport([server]);
    const md = formatMarkdown(report);

    expect(md).toContain("Evaluate absence of confirmation gates");
  });

  it("does not include warnings section when no warnings", () => {
    const server = buildServerReport(
      "clean",
      "/local",
      "python",
      makeTools(),
      makePatterns(),
      []
    );
    const report = buildAuditReport([server]);
    const md = formatMarkdown(report);

    expect(md).not.toContain("### Warnings");
  });

  it("includes Domain 5 indicator rows with placeholder text", () => {
    const server = buildServerReport(
      "test-server",
      "/local",
      "python",
      makeTools(),
      makePatterns(),
      []
    );
    const report = buildAuditReport([server]);
    const md = formatMarkdown(report);

    expect(md).toContain("Self-modification prevention (Domain 5)");
    expect(md).toContain("Sub-agent authority constraints (Domain 5)");
    expect(md).toContain("Permission boundary enforcement (Domain 5)");
    expect(md).toContain("(human review required)");
  });

  it("includes screening hints section when screeningSignals present", () => {
    const server = buildServerReport(
      "screened-server",
      "/local",
      "python",
      makeTools(),
      makePatterns(),
      []
    );
    server.screeningSignals = {
      selfModificationPrevention: {
        likelihood: "likely-absent",
        notes: "tool mutation at admin.py:47",
        citations: [{ file: "admin.py", line: 47 }],
      },
      subAgentAuthorityConstraints: {
        likelihood: "unclear",
        notes: "No spawning patterns detected",
        citations: [],
      },
      permissionBoundaryEnforcement: {
        likelihood: "likely-present",
        notes: "check_scope() in handlers",
        citations: [{ file: "handlers/data.py", line: 22 }],
      },
    };
    server.screeningMetadata = {
      model: "claude-haiku-4-5-20251001",
      promptVersion: "v1",
      totalTokens: 12345,
      estimatedCostUsd: 0.015,
      indicatorsScreened: [
        "selfModificationPrevention",
        "subAgentAuthorityConstraints",
        "permissionBoundaryEnforcement",
      ],
    };

    const report = buildAuditReport([server]);
    const md = formatMarkdown(report);

    expect(md).toContain("Human Review Required (Domain 5)");
    expect(md).toContain("likely-absent");
    expect(md).toContain("admin.py:47");
    expect(md).toContain("claude-haiku-4-5-20251001");
    expect(md).toContain("12345 tokens");
    expect(md).toContain("$0.0150");
  });

  it("includes test tool coverage section when testToolCoverage present", () => {
    const server = buildServerReport(
      "covered-server",
      "/local",
      "python",
      makeTools(),
      makePatterns(),
      []
    );
    server.testToolCoverage = [
      {
        names: ["list_items", "export_data"],
        sourceFile: "test_tools.py",
        coverage: {
          extractedCount: 2,
          assertedCount: 2,
          missingFromExtraction: ["export_data"],
          missingFromTests: ["delete_item"],
        },
      },
    ];
    const report = buildAuditReport([server]);
    const md = formatMarkdown(report);

    expect(md).toContain("### Test Tool Coverage");
    expect(md).toContain("test_tools.py");
    expect(md).toContain("Asserted: 2 | Extracted: 2");
    expect(md).toContain("In tests but not extracted: export_data");
    expect(md).toContain("Extracted but not in tests: delete_item");
  });

  it("does not include test tool coverage section when absent", () => {
    const server = buildServerReport(
      "no-tests",
      "/local",
      "python",
      makeTools(),
      makePatterns(),
      []
    );
    const report = buildAuditReport([server]);
    const md = formatMarkdown(report);

    expect(md).not.toContain("### Test Tool Coverage");
  });

  it("does not include screening hints section when screeningSignals absent", () => {
    const server = buildServerReport(
      "unscreened",
      "/local",
      "python",
      makeTools(),
      makePatterns(),
      []
    );
    const report = buildAuditReport([server]);
    const md = formatMarkdown(report);

    expect(md).not.toContain("Human Review Required (Domain 5)");
  });
});

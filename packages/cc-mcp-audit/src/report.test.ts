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
});

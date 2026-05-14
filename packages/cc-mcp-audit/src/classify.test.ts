import { describe, it, expect } from "vitest";
import { refineClassifications } from "./classify.js";
import type { ExtractedTool } from "./types.js";

function makeTool(
  overrides: Partial<ExtractedTool>
): ExtractedTool {
  return {
    name: "test_tool",
    description: "",
    classification: "unknown",
    writeSignals: [],
    sensitivity: "non-sensitive",
    sensitivityCategory: null,
    sensitivitySignals: [],
    sourceFile: "test.py",
    sourceLine: 1,
    ...overrides,
  };
}

describe("refineClassifications", () => {
  it("downgrades write to read when description indicates safe context", () => {
    const tools = [
      makeTool({
        name: "execute_query",
        description: "Execute a read-only SQL query",
        classification: "write",
        writeSignals: ["execute"],
      }),
    ];

    const refined = refineClassifications(tools);
    expect(refined[0].classification).toBe("read");
    expect(refined[0].writeSignals).not.toContain("execute");
  });

  it("downgrades write to read for safe/select/query contexts", () => {
    const cases = [
      "Execute a safe database inspection",
      "Run a SELECT query against the database",
      "Analyze and inspect table structure",
    ];

    for (const description of cases) {
      const tools = [
        makeTool({
          classification: "write",
          description,
          writeSignals: ["execute"],
        }),
      ];
      const refined = refineClassifications(tools);
      expect(refined[0].classification).toBe("read");
    }
  });

  it("upgrades read to write for full/unrestricted access", () => {
    const tools = [
      makeTool({
        name: "query_db",
        description: "Query database with full access",
        classification: "read",
        writeSignals: [],
      }),
    ];

    const refined = refineClassifications(tools);
    expect(refined[0].classification).toBe("write");
    expect(refined[0].writeSignals).toContain("full-access");
  });

  it("does not modify correctly classified tools", () => {
    const tools = [
      makeTool({
        name: "list_items",
        description: "List all items",
        classification: "read",
      }),
      makeTool({
        name: "delete_item",
        description: "Delete an item permanently",
        classification: "write",
        writeSignals: ["delete"],
      }),
    ];

    const refined = refineClassifications(tools);
    expect(refined[0].classification).toBe("read");
    expect(refined[1].classification).toBe("write");
  });

  it("preserves sensitivity fields when reclassifying read/write", () => {
    const tools = [
      makeTool({
        name: "execute_query",
        description: "Execute a read-only SQL query on patient database",
        classification: "write",
        writeSignals: ["execute"],
        sensitivity: "sensitive",
        sensitivityCategory: "confidentiality",
        sensitivitySignals: ["patient"],
      }),
    ];

    const refined = refineClassifications(tools);
    // Classification changed from write -> read
    expect(refined[0].classification).toBe("read");
    // Sensitivity preserved (orthogonal axis)
    expect(refined[0].sensitivity).toBe("sensitive");
    expect(refined[0].sensitivityCategory).toBe("confidentiality");
    expect(refined[0].sensitivitySignals).toContain("patient");
  });

  it("does not mutate the original array", () => {
    const tools = [
      makeTool({
        classification: "write",
        description: "Execute a read-only query",
        writeSignals: ["execute"],
      }),
    ];

    const refined = refineClassifications(tools);
    expect(tools[0].classification).toBe("write");
    expect(refined[0].classification).toBe("read");
  });
});

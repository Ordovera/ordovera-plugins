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
    sensitiveKeywords: [],
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
        sensitiveKeywords: ["execute"],
      }),
    ];

    const refined = refineClassifications(tools);
    expect(refined[0].classification).toBe("read");
    expect(refined[0].sensitiveKeywords).not.toContain("execute");
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
          sensitiveKeywords: ["execute"],
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
        sensitiveKeywords: [],
      }),
    ];

    const refined = refineClassifications(tools);
    expect(refined[0].classification).toBe("write");
    expect(refined[0].sensitiveKeywords).toContain("full-access");
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
        sensitiveKeywords: ["delete"],
      }),
    ];

    const refined = refineClassifications(tools);
    expect(refined[0].classification).toBe("read");
    expect(refined[1].classification).toBe("write");
  });

  it("does not mutate the original array", () => {
    const tools = [
      makeTool({
        classification: "write",
        description: "Execute a read-only query",
        sensitiveKeywords: ["execute"],
      }),
    ];

    const refined = refineClassifications(tools);
    expect(tools[0].classification).toBe("write");
    expect(refined[0].classification).toBe("read");
  });
});

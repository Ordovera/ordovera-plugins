import { describe, it, expect } from "vitest";
import { detectGaps } from "./gaps.js";
import type { ExtractedTool } from "./types.js";
import type { PatternResults } from "./patterns.js";

function makeTool(overrides: Partial<ExtractedTool>): ExtractedTool {
  return {
    name: "test_tool",
    description: "",
    classification: "unknown",
    sensitiveKeywords: [],
    sourceFile: "server.py",
    sourceLine: 1,
    ...overrides,
  };
}

function makePatterns(overrides: Partial<PatternResults> = {}): PatternResults {
  return {
    auth: [],
    logging: [],
    gates: [],
    stagedExecution: [],
    actorAttribution: [],
    rateLimit: [],
    leastPrivilege: [],
    ...overrides,
  };
}

describe("detectGaps", () => {
  it("detects ungated-write when write tools lack co-located gates", () => {
    const tools = [
      makeTool({ name: "delete_item", classification: "write", sourceFile: "tools.py" }),
    ];
    const patterns = makePatterns({
      gates: [{ type: "gate", match: "confirm", file: "other.py", line: 1 }],
    });

    const gaps = detectGaps(tools, patterns, "none");
    const ungated = gaps.find((g) => g.pattern === "ungated-write");
    expect(ungated).toBeDefined();
    expect(ungated!.confidence).toBe("high");
    expect(ungated!.instances[0].tool).toBe("delete_item");
  });

  it("does not flag ungated-write when gate is in the same file", () => {
    const tools = [
      makeTool({ name: "delete_item", classification: "write", sourceFile: "tools.py" }),
    ];
    const patterns = makePatterns({
      gates: [{ type: "gate", match: "confirm", file: "tools.py", line: 5 }],
    });

    const gaps = detectGaps(tools, patterns, "none");
    expect(gaps.find((g) => g.pattern === "ungated-write")).toBeUndefined();
  });

  it("detects global-auth-over-sensitive-tools with high confidence for global", () => {
    const tools = [
      makeTool({ name: "list_items", classification: "read" }),
      makeTool({ name: "drop_table", classification: "write" }),
    ];
    const patterns = makePatterns({
      auth: [{ type: "auth", match: "Bearer", file: "auth.py", line: 1 }],
    });

    const gaps = detectGaps(tools, patterns, "global");
    const gap = gaps.find((g) => g.pattern === "global-auth-over-sensitive-tools");
    expect(gap).toBeDefined();
    expect(gap!.confidence).toBe("high");
    expect(gap!.instances[0].tool).toBe("drop_table");
  });

  it("detects global-auth-over-sensitive-tools with low confidence for unclear", () => {
    const tools = [
      makeTool({ name: "list_items", classification: "read" }),
      makeTool({ name: "drop_table", classification: "write" }),
    ];
    const patterns = makePatterns({
      auth: [{ type: "auth", match: "Bearer", file: "auth.py", line: 1 }],
    });

    const gaps = detectGaps(tools, patterns, "unclear");
    const gap = gaps.find((g) => g.pattern === "global-auth-over-sensitive-tools");
    expect(gap).toBeDefined();
    expect(gap!.confidence).toBe("low");
  });

  it("does not flag global-auth when all tools are same classification", () => {
    const tools = [
      makeTool({ name: "delete_a", classification: "write" }),
      makeTool({ name: "delete_b", classification: "write" }),
    ];
    const patterns = makePatterns({
      auth: [{ type: "auth", match: "Bearer", file: "auth.py", line: 1 }],
    });

    const gaps = detectGaps(tools, patterns, "global");
    expect(gaps.find((g) => g.pattern === "global-auth-over-sensitive-tools")).toBeUndefined();
  });

  it("detects auth-without-actor-logging when attribution not log-adjacent", () => {
    const tools = [makeTool({ classification: "read" })];
    const patterns = makePatterns({
      auth: [{ type: "auth", match: "Bearer", file: "auth.py", line: 1 }],
      logging: [{ type: "logging", match: "logger.info", file: "server.py", line: 10 }],
      // user_id exists but in a different file -- not log-adjacent
      actorAttribution: [{ type: "attribution", match: "user_id", file: "models.py", line: 5 }],
    });

    const gaps = detectGaps(tools, patterns, "global");
    expect(gaps.find((g) => g.pattern === "auth-without-actor-logging")).toBeDefined();
  });

  it("does not flag auth-without-actor-logging when attribution is log-adjacent", () => {
    const tools = [makeTool({ classification: "read" })];
    const patterns = makePatterns({
      auth: [{ type: "auth", match: "Bearer", file: "auth.py", line: 1 }],
      logging: [{ type: "logging", match: "logger.info", file: "server.py", line: 10 }],
      // user_id on same line as logging -- log-adjacent
      actorAttribution: [{ type: "attribution", match: "user_id", file: "server.py", line: 10 }],
    });

    const gaps = detectGaps(tools, patterns, "global");
    expect(gaps.find((g) => g.pattern === "auth-without-actor-logging")).toBeUndefined();
  });

  it("does not flag auth-without-actor-logging when attribution is within 3 lines", () => {
    const tools = [makeTool({ classification: "read" })];
    const patterns = makePatterns({
      auth: [{ type: "auth", match: "Bearer", file: "auth.py", line: 1 }],
      logging: [{ type: "logging", match: "logger.info", file: "server.py", line: 10 }],
      actorAttribution: [{ type: "attribution", match: "user_id", file: "server.py", line: 12 }],
    });

    const gaps = detectGaps(tools, patterns, "global");
    expect(gaps.find((g) => g.pattern === "auth-without-actor-logging")).toBeUndefined();
  });

  it("detects logging-without-attribution when no auth exists", () => {
    const tools = [makeTool({ classification: "read" })];
    const patterns = makePatterns({
      logging: [{ type: "logging", match: "logger.info", file: "server.py", line: 10 }],
    });

    const gaps = detectGaps(tools, patterns, "none");
    const gap = gaps.find((g) => g.pattern === "logging-without-attribution");
    expect(gap).toBeDefined();
    expect(gap!.confidence).toBe("medium");
  });

  it("detects destructive-without-audit-trail", () => {
    const tools = [
      makeTool({
        name: "drop_table",
        description: "Drop a database table permanently",
        classification: "write",
        sourceFile: "dangerous.py",
      }),
    ];
    const patterns = makePatterns({
      logging: [{ type: "logging", match: "logger.info", file: "other.py", line: 5 }],
    });

    const gaps = detectGaps(tools, patterns, "none");
    const gap = gaps.find((g) => g.pattern === "destructive-without-audit-trail");
    expect(gap).toBeDefined();
    expect(gap!.instances[0].tool).toBe("drop_table");
  });

  it("does not flag destructive-without-audit-trail when logging is co-located", () => {
    const tools = [
      makeTool({
        name: "drop_table",
        description: "Drop a database table",
        classification: "write",
        sourceFile: "server.py",
      }),
    ];
    const patterns = makePatterns({
      logging: [{ type: "logging", match: "logger.info", file: "server.py", line: 5 }],
    });

    const gaps = detectGaps(tools, patterns, "none");
    expect(gaps.find((g) => g.pattern === "destructive-without-audit-trail")).toBeUndefined();
  });

  it("does not flag 'remove' as destructive", () => {
    const tools = [
      makeTool({
        name: "remove_listener",
        description: "Remove an event listener",
        classification: "write",
        sourceFile: "events.py",
      }),
    ];
    const patterns = makePatterns();

    const gaps = detectGaps(tools, patterns, "none");
    expect(gaps.find((g) => g.pattern === "destructive-without-audit-trail")).toBeUndefined();
  });

  it("returns empty array when no gaps detected", () => {
    const tools = [makeTool({ name: "list_items", classification: "read" })];
    const patterns = makePatterns();

    const gaps = detectGaps(tools, patterns, "none");
    expect(gaps).toEqual([]);
  });
});

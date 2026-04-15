import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSession } from "./analyzer.js";
import { parseSessionFile } from "./parser.js";
import type { PolicyFile, SessionMessage } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "..", "test-fixtures");

async function loadSession(filename: string): Promise<SessionMessage[]> {
  const messages: SessionMessage[] = [];
  for await (const msg of parseSessionFile(resolve(fixturesDir, filename))) {
    messages.push(msg);
  }
  return messages;
}

async function loadPolicy(filename: string): Promise<PolicyFile> {
  const content = await readFile(resolve(fixturesDir, filename), "utf-8");
  return JSON.parse(content) as PolicyFile;
}

describe("analyzeSession", () => {
  describe("minimal session", () => {
    it("counts human turns correctly", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const report = analyzeSession(messages, "minimal-session.jsonl");

      // Two human text turns: "Hello, help me..." and "Thanks, that looks good"
      expect(report.message_counts.user).toBe(2);
    });

    it("counts assistant turns", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const report = analyzeSession(messages, "minimal-session.jsonl");

      expect(report.message_counts.assistant).toBe(3);
    });

    it("counts tool uses", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const report = analyzeSession(messages, "minimal-session.jsonl");

      // Read + Edit = 2 tool uses
      expect(report.message_counts.tool_use).toBe(2);
    });

    it("builds tool inventory", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const report = analyzeSession(messages, "minimal-session.jsonl");

      const toolNames = report.tool_inventory.map((t) => t.name);
      expect(toolNames).toContain("Read");
      expect(toolNames).toContain("Edit");
    });

    it("tracks file modifications", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const report = analyzeSession(messages, "minimal-session.jsonl");

      // Edit on /tmp/test/index.ts
      expect(report.file_modifications).toHaveLength(1);
      expect(report.file_modifications[0].path).toBe("/tmp/test/index.ts");
      expect(report.file_modifications[0].tool).toBe("Edit");
    });

    it("extracts session ID", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const report = analyzeSession(messages, "minimal-session.jsonl");

      expect(report.session_id).toBe("test-session-1");
    });

    it("computes timestamp range", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const report = analyzeSession(messages, "minimal-session.jsonl");

      expect(report.timestamp_range.start).toBe("2026-04-15T10:00:00.000Z");
      expect(report.timestamp_range.end).toBe("2026-04-15T10:00:20.000Z");
    });

    it("reports no MCP servers", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const report = analyzeSession(messages, "minimal-session.jsonl");

      expect(report.mcp_servers).toEqual([]);
    });

    it("reports no policy violations without policy", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const report = analyzeSession(messages, "minimal-session.jsonl");

      expect(report.policy_violations).toEqual([]);
    });
  });

  describe("MCP session", () => {
    it("detects MCP servers", async () => {
      const messages = await loadSession("mcp-session.jsonl");
      const report = analyzeSession(messages, "mcp-session.jsonl");

      expect(report.mcp_servers).toContain("claude_ai_Atlassian");
      expect(report.mcp_servers).toContain("claude_ai_Gmail");
    });

    it("includes MCP tools in inventory", async () => {
      const messages = await loadSession("mcp-session.jsonl");
      const report = analyzeSession(messages, "mcp-session.jsonl");

      const mcpTools = report.tool_inventory.filter((t) => t.is_mcp);
      expect(mcpTools.length).toBe(2);
    });

    it("tracks Write to .env as file modification", async () => {
      const messages = await loadSession("mcp-session.jsonl");
      const report = analyzeSession(messages, "mcp-session.jsonl");

      const envMod = report.file_modifications.find((m) =>
        m.path.includes(".env")
      );
      expect(envMod).toBeDefined();
      expect(envMod!.tool).toBe("Write");
    });
  });

  describe("policy enforcement", () => {
    it("flags denied MCP servers", async () => {
      const messages = await loadSession("mcp-session.jsonl");
      const policy = await loadPolicy("test-policy.json");
      const report = analyzeSession(messages, "mcp-session.jsonl", policy);

      const denied = report.policy_violations.filter(
        (v) => v.rule === "denied_mcp_server"
      );
      expect(denied.length).toBe(1);
      expect(denied[0].detail).toContain("claude_ai_Gmail");
    });

    it("flags unapproved MCP servers", async () => {
      const messages = await loadSession("mcp-session.jsonl");
      const policy = await loadPolicy("test-policy.json");
      const report = analyzeSession(messages, "mcp-session.jsonl", policy);

      const unapproved = report.policy_violations.filter(
        (v) => v.rule === "unapproved_mcp_server"
      );
      // Gmail is both denied AND unapproved (not in approved list)
      expect(unapproved.length).toBe(1);
      expect(unapproved[0].detail).toContain("claude_ai_Gmail");
    });

    it("flags restricted path access", async () => {
      const messages = await loadSession("mcp-session.jsonl");
      const policy = await loadPolicy("test-policy.json");
      const report = analyzeSession(messages, "mcp-session.jsonl", policy);

      const restricted = report.policy_violations.filter(
        (v) => v.rule === "restricted_path"
      );
      expect(restricted.length).toBe(1);
      expect(restricted[0].detail).toContain(".env");
    });

    it("flags max autonomous turns exceeded", async () => {
      const messages = await loadSession("mcp-session.jsonl");
      const policy = await loadPolicy("test-policy.json");
      const report = analyzeSession(messages, "mcp-session.jsonl", policy);

      const autonomy = report.policy_violations.filter(
        (v) => v.rule === "max_autonomous_turns"
      );
      expect(autonomy.length).toBe(1);
      expect(autonomy[0].detail).toContain("limit: 3");
    });

    it("flags denied tools", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const policy = await loadPolicy("denied-tools-policy.json");
      const report = analyzeSession(messages, "minimal-session.jsonl", policy);

      const denied = report.policy_violations.filter(
        (v) => v.rule === "denied_tool"
      );
      // Edit is not in denied list, but Read is not either -- neither is denied
      // Actually: denied_tools is ["Bash", "Write"], and the session uses Read + Edit
      // Neither Read nor Edit is on the deny list, so 0 denied_tool violations
      expect(denied.length).toBe(0);
    });

    it("flags unapproved tools via allowlist", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const policy = await loadPolicy("denied-tools-policy.json");
      const report = analyzeSession(messages, "minimal-session.jsonl", policy);

      const unapproved = report.policy_violations.filter(
        (v) => v.rule === "unapproved_tool"
      );
      // approved_tools is ["Read", "Grep", "Glob"]
      // Session uses Read (approved) and Edit (not approved) -> 1 violation
      expect(unapproved.length).toBe(1);
      expect(unapproved[0].detail).toContain("Edit");
    });
  });

  describe("parser edge cases", () => {
    it("skips malformed lines and unknown types", async () => {
      const messages = await loadSession("malformed-session.jsonl");

      // File has: garbage line, valid user, broken json, unknown_type, valid assistant
      // Should yield only the 2 valid messages
      expect(messages.length).toBe(2);
      expect(messages[0].type).toBe("user");
      expect(messages[1].type).toBe("assistant");
    });

    it("produces a valid report from a malformed file", async () => {
      const messages = await loadSession("malformed-session.jsonl");
      const report = analyzeSession(messages, "malformed-session.jsonl");

      expect(report.session_id).toBe("test-malformed");
      expect(report.message_counts.user).toBe(1);
      expect(report.message_counts.assistant).toBe(1);
    });
  });

  describe("empty input", () => {
    it("handles empty messages array", () => {
      const report = analyzeSession([], "empty.jsonl");

      expect(report.session_id).toBeNull();
      expect(report.message_counts.user).toBe(0);
      expect(report.message_counts.assistant).toBe(0);
      expect(report.tool_inventory).toEqual([]);
      expect(report.mcp_servers).toEqual([]);
      expect(report.file_modifications).toEqual([]);
      expect(report.policy_violations).toEqual([]);
      expect(report.timestamp_range.start).toBeNull();
      expect(report.timestamp_range.end).toBeNull();
    });
  });

  describe("Bash file modification detection", () => {
    it("detects redirect with >", async () => {
      const messages = await loadSession("bash-writes-session.jsonl");
      const report = analyzeSession(messages, "bash-writes-session.jsonl");

      const bashMods = report.file_modifications.filter(
        (m) => m.tool === "Bash"
      );
      // echo hello > /tmp/output.txt -- detected (>)
      // cat data.json | tee /tmp/backup.json -- detected (tee)
      // npm test -- NOT detected (no write signal)
      // echo data >> /tmp/append.log -- detected (>>)
      expect(bashMods.length).toBe(3);
    });

    it("does not flag non-writing Bash commands", async () => {
      const messages = await loadSession("bash-writes-session.jsonl");
      const report = analyzeSession(messages, "bash-writes-session.jsonl");

      // 4 Bash tool_uses total, 3 flagged as file modifications
      const bashTools = report.tool_inventory.find((t) => t.name === "Bash");
      expect(bashTools?.count).toBe(4);
      expect(
        report.file_modifications.filter((m) => m.tool === "Bash").length
      ).toBe(3);
    });
  });

  describe("tool result counting", () => {
    it("counts tool results from user messages", async () => {
      const messages = await loadSession("minimal-session.jsonl");
      const report = analyzeSession(messages, "minimal-session.jsonl");

      // 2 tool_result blocks (Read result + Edit result)
      expect(report.message_counts.tool_result).toBe(2);
    });
  });
});

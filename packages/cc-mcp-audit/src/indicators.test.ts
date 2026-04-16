import { describe, it, expect } from "vitest";
import { deriveIndicators } from "./indicators.js";
import type { ServerReport, ExtractedTool } from "./types.js";

function makeReport(overrides: Partial<ServerReport> = {}): ServerReport {
  return {
    name: "test",
    source: "/test",
    commitHash: null,
    language: "python",
    tools: [],
    sensitiveToolCount: 0,
    patterns: {
      auth: [], logging: [], gates: [], stagedExecution: [],
      actorAttribution: [], rateLimit: [], leastPrivilege: [],
    },
    flags: {
      hasAuth: false,
      hasPerToolAuth: false,
      hasLogging: false,
      hasAttributionIdentifiers: false,
      hasAttributedLogging: false,
      hasConfirmationGates: false,
      hasStagedExecution: false,
      hasWriteTools: false,
      hasRateLimiting: false,
      hasLeastPrivilege: false,
    },
    indicators: {
      authentication: "Absent", perToolAuth: "Absent",
      readWriteSeparation: "Absent", leastPrivilege: "Absent",
      confirmationGates: "Absent", stagedExecution: "Absent",
      auditLogging: "Absent",
      actorAttribution: "Absent", rateLimiting: "Absent",
      sensitiveCapabilityIsolation: "Absent",
      selfModificationPrevention: null,
      subAgentAuthorityConstraints: null,
      permissionBoundaryEnforcement: null,
    },
    accountabilityGaps: [],
    warnings: [],
    ...overrides,
  };
}

function makeTool(overrides: Partial<ExtractedTool>): ExtractedTool {
  return {
    name: "t",
    description: "",
    classification: "unknown",
    sensitiveKeywords: [],
    sourceFile: "f.py",
    sourceLine: 1,
    ...overrides,
  };
}

describe("deriveIndicators", () => {
  describe("authentication", () => {
    it("Present when hasAuth flag is set", () => {
      const r = makeReport({ flags: { ...makeReport().flags, hasAuth: true } });
      expect(deriveIndicators(r).authentication).toBe("Present");
    });

    it("Absent when no auth and tools extracted normally", () => {
      const r = makeReport({ tools: [makeTool({ name: "a" })] });
      expect(deriveIndicators(r).authentication).toBe("Absent");
    });

    it("Indeterminate when extraction was incomplete", () => {
      const r = makeReport({
        warnings: ["MCP framework detected but no tools extracted"],
      });
      expect(deriveIndicators(r).authentication).toBe("Indeterminate");
    });
  });

  describe("perToolAuth", () => {
    it("Absent when no auth at all", () => {
      expect(deriveIndicators(makeReport()).perToolAuth).toBe("Absent");
    });

    it("Present when hasPerToolAuth flag is set", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasAuth: true, hasPerToolAuth: true },
      });
      expect(deriveIndicators(r).perToolAuth).toBe("Present");
    });

    it("Indeterminate when auth architecture is ambiguous", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasAuth: true },
        warnings: ["Auth architecture is ambiguous -- found auth patterns in both"],
      });
      expect(deriveIndicators(r).perToolAuth).toBe("Indeterminate");
    });

    it("Absent when auth is clearly global", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasAuth: true },
      });
      expect(deriveIndicators(r).perToolAuth).toBe("Absent");
    });
  });

  describe("readWriteSeparation", () => {
    it("Indeterminate when no tools extracted", () => {
      expect(deriveIndicators(makeReport()).readWriteSeparation).toBe("Indeterminate");
    });

    it("Indeterminate when extraction incomplete", () => {
      const r = makeReport({
        warnings: ["MCP framework detected but no tools extracted"],
      });
      expect(deriveIndicators(r).readWriteSeparation).toBe("Indeterminate");
    });

    it("Present when both read and write tools exist", () => {
      const r = makeReport({
        tools: [
          makeTool({ name: "read_a", classification: "read" }),
          makeTool({ name: "write_a", classification: "write" }),
        ],
      });
      expect(deriveIndicators(r).readWriteSeparation).toBe("Present");
    });

    it("Indeterminate when only unknown classifications", () => {
      const r = makeReport({
        tools: [makeTool({ name: "a", classification: "unknown" })],
      });
      expect(deriveIndicators(r).readWriteSeparation).toBe("Indeterminate");
    });
  });

  describe("leastPrivilege", () => {
    it("Present when hasLeastPrivilege flag is set", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasLeastPrivilege: true },
      });
      expect(deriveIndicators(r).leastPrivilege).toBe("Present");
    });

    it("Absent otherwise", () => {
      expect(deriveIndicators(makeReport()).leastPrivilege).toBe("Absent");
    });
  });

  describe("confirmationGates", () => {
    it("Present when gates detected", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasConfirmationGates: true },
      });
      expect(deriveIndicators(r).confirmationGates).toBe("Present");
    });

    it("Absent when no write tools (mechanism not applicable)", () => {
      expect(deriveIndicators(makeReport()).confirmationGates).toBe("Absent");
    });

    it("Indeterminate when write tools exist but extraction was incomplete", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasWriteTools: true },
        warnings: ["MCP framework detected but no tools extracted"],
      });
      expect(deriveIndicators(r).confirmationGates).toBe("Indeterminate");
    });

    it("Absent when write tools exist, extraction complete, no gates", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasWriteTools: true },
        tools: [makeTool({ classification: "write" })],
      });
      expect(deriveIndicators(r).confirmationGates).toBe("Absent");
    });
  });

  describe("Domain 5 indicators", () => {
    it("returns null for all three Domain 5 indicators regardless of input", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasAuth: true, hasLogging: true },
      });
      const indicators = deriveIndicators(r);
      expect(indicators.selfModificationPrevention).toBeNull();
      expect(indicators.subAgentAuthorityConstraints).toBeNull();
      expect(indicators.permissionBoundaryEnforcement).toBeNull();
    });

    it("Domain 5 null slots persist even when extraction is rich", () => {
      const r = makeReport({
        tools: [
          makeTool({ name: "read_a", classification: "read" }),
          makeTool({ name: "write_a", classification: "write" }),
        ],
        flags: {
          ...makeReport().flags,
          hasAuth: true,
          hasPerToolAuth: true,
          hasLogging: true,
          hasAttributedLogging: true,
          hasConfirmationGates: true,
          hasWriteTools: true,
          hasRateLimiting: true,
          hasLeastPrivilege: true,
        },
      });
      const indicators = deriveIndicators(r);
      expect(indicators.selfModificationPrevention).toBeNull();
      expect(indicators.subAgentAuthorityConstraints).toBeNull();
      expect(indicators.permissionBoundaryEnforcement).toBeNull();
    });
  });

  describe("stagedExecution", () => {
    it("Present when hasStagedExecution flag is set", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasStagedExecution: true },
      });
      expect(deriveIndicators(r).stagedExecution).toBe("Present");
    });

    it("Absent when no write tools (mechanism not applicable)", () => {
      expect(deriveIndicators(makeReport()).stagedExecution).toBe("Absent");
    });

    it("Indeterminate when write tools exist but extraction was incomplete", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasWriteTools: true },
        warnings: ["MCP framework detected but no tools extracted"],
      });
      expect(deriveIndicators(r).stagedExecution).toBe("Indeterminate");
    });

    it("Absent when write tools exist, extraction complete, no staged execution", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasWriteTools: true },
        tools: [makeTool({ classification: "write" })],
      });
      expect(deriveIndicators(r).stagedExecution).toBe("Absent");
    });

    it("is independent of confirmationGates", () => {
      // A server can have staged execution without confirmation gates
      const r = makeReport({
        flags: {
          ...makeReport().flags,
          hasWriteTools: true,
          hasStagedExecution: true,
          hasConfirmationGates: false,
        },
      });
      const ind = deriveIndicators(r);
      expect(ind.stagedExecution).toBe("Present");
      expect(ind.confirmationGates).toBe("Absent");
    });
  });

  describe("actorAttribution", () => {
    it("Present when log-adjacent attribution detected", () => {
      const r = makeReport({
        flags: {
          ...makeReport().flags,
          hasLogging: true,
          hasAttributedLogging: true,
          hasAttributionIdentifiers: true,
        },
      });
      expect(deriveIndicators(r).actorAttribution).toBe("Present");
    });

    it("Absent when no logging at all", () => {
      expect(deriveIndicators(makeReport()).actorAttribution).toBe("Absent");
    });

    it("Indeterminate when logging exists, identifiers exist, but not log-adjacent", () => {
      const r = makeReport({
        flags: {
          ...makeReport().flags,
          hasLogging: true,
          hasAttributionIdentifiers: true,
          hasAttributedLogging: false,
        },
      });
      expect(deriveIndicators(r).actorAttribution).toBe("Indeterminate");
    });

    it("Absent when logging exists but no identifiers anywhere", () => {
      const r = makeReport({
        flags: {
          ...makeReport().flags,
          hasLogging: true,
        },
      });
      expect(deriveIndicators(r).actorAttribution).toBe("Absent");
    });
  });

  describe("rateLimiting", () => {
    it("Present when hasRateLimiting flag is set", () => {
      const r = makeReport({
        flags: { ...makeReport().flags, hasRateLimiting: true },
      });
      expect(deriveIndicators(r).rateLimiting).toBe("Present");
    });

    it("Absent otherwise", () => {
      expect(deriveIndicators(makeReport()).rateLimiting).toBe("Absent");
    });
  });

  describe("sensitiveCapabilityIsolation", () => {
    it("Indeterminate when no tools", () => {
      expect(deriveIndicators(makeReport()).sensitiveCapabilityIsolation).toBe(
        "Indeterminate"
      );
    });

    it("Absent when no write tools exist (mechanism not applicable)", () => {
      const r = makeReport({
        tools: [
          makeTool({ name: "list_a", classification: "read", sourceFile: "a.py" }),
          makeTool({ name: "list_b", classification: "read", sourceFile: "a.py" }),
          makeTool({ name: "list_c", classification: "read", sourceFile: "a.py" }),
        ],
      });
      expect(deriveIndicators(r).sensitiveCapabilityIsolation).toBe("Absent");
    });

    it("Indeterminate when fewer than 3 tools per bucket", () => {
      const r = makeReport({
        tools: [
          makeTool({ name: "read_a", classification: "read", sourceFile: "read.py" }),
          makeTool({ name: "read_b", classification: "read", sourceFile: "read.py" }),
          makeTool({ name: "write_a", classification: "write", sourceFile: "write.py" }),
          makeTool({ name: "write_b", classification: "write", sourceFile: "write.py" }),
        ],
      });
      expect(deriveIndicators(r).sensitiveCapabilityIsolation).toBe(
        "Indeterminate"
      );
    });

    it("Present when read and write tools live in distinct files", () => {
      const r = makeReport({
        tools: [
          makeTool({ name: "read_a", classification: "read", sourceFile: "queries.py" }),
          makeTool({ name: "read_b", classification: "read", sourceFile: "queries.py" }),
          makeTool({ name: "read_c", classification: "read", sourceFile: "queries.py" }),
          makeTool({ name: "write_a", classification: "write", sourceFile: "mutations.py" }),
          makeTool({ name: "write_b", classification: "write", sourceFile: "mutations.py" }),
          makeTool({ name: "write_c", classification: "write", sourceFile: "mutations.py" }),
        ],
      });
      expect(deriveIndicators(r).sensitiveCapabilityIsolation).toBe("Present");
    });

    it("Present when tools use disjoint namespace prefixes (dot)", () => {
      const r = makeReport({
        tools: [
          makeTool({ name: "user.read_profile", classification: "read", sourceFile: "s.py" }),
          makeTool({ name: "user.list_items", classification: "read", sourceFile: "s.py" }),
          makeTool({ name: "user.search", classification: "read", sourceFile: "s.py" }),
          makeTool({ name: "admin.delete_user", classification: "write", sourceFile: "s.py" }),
          makeTool({ name: "admin.reset_system", classification: "write", sourceFile: "s.py" }),
          makeTool({ name: "admin.purge_cache", classification: "write", sourceFile: "s.py" }),
        ],
      });
      expect(deriveIndicators(r).sensitiveCapabilityIsolation).toBe("Present");
    });

    it("Present when tools use disjoint namespace prefixes (underscore)", () => {
      const r = makeReport({
        tools: [
          makeTool({ name: "user_get", classification: "read", sourceFile: "s.py" }),
          makeTool({ name: "user_list", classification: "read", sourceFile: "s.py" }),
          makeTool({ name: "user_search", classification: "read", sourceFile: "s.py" }),
          makeTool({ name: "admin_delete", classification: "write", sourceFile: "s.py" }),
          makeTool({ name: "admin_reset", classification: "write", sourceFile: "s.py" }),
          makeTool({ name: "admin_purge", classification: "write", sourceFile: "s.py" }),
        ],
      });
      expect(deriveIndicators(r).sensitiveCapabilityIsolation).toBe("Present");
    });

    it("Absent when all tools share the same file and have no namespace separation", () => {
      const r = makeReport({
        tools: [
          makeTool({ name: "list_items", classification: "read", sourceFile: "server.py" }),
          makeTool({ name: "get_item", classification: "read", sourceFile: "server.py" }),
          makeTool({ name: "search", classification: "read", sourceFile: "server.py" }),
          makeTool({ name: "create_item", classification: "write", sourceFile: "server.py" }),
          makeTool({ name: "update_item", classification: "write", sourceFile: "server.py" }),
          makeTool({ name: "delete_item", classification: "write", sourceFile: "server.py" }),
        ],
      });
      expect(deriveIndicators(r).sensitiveCapabilityIsolation).toBe("Absent");
    });

    it("Indeterminate when grouping is mixed (some shared, some separated)", () => {
      // Tool names intentionally lack namespace prefixes so the
      // namespace-separation branch cannot fire -- this exercises the
      // file-only grouping path
      const r = makeReport({
        tools: [
          makeTool({ name: "list_a", classification: "read", sourceFile: "a.py" }),
          makeTool({ name: "list_b", classification: "read", sourceFile: "a.py" }),
          makeTool({ name: "list_c", classification: "read", sourceFile: "b.py" }),
          makeTool({ name: "create_a", classification: "write", sourceFile: "a.py" }),
          makeTool({ name: "update_b", classification: "write", sourceFile: "c.py" }),
          makeTool({ name: "delete_c", classification: "write", sourceFile: "c.py" }),
        ],
      });
      expect(deriveIndicators(r).sensitiveCapabilityIsolation).toBe(
        "Indeterminate"
      );
    });
  });
});

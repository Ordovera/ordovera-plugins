import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  toEvidence,
  toEvidenceBatch,
  resolveSourceInfo,
  _resetSourceCache,
} from "./evidence.js";
import type {
  ServerReport,
  AuditReport,
  EvidenceSourceInfo,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const fakeSource: EvidenceSourceInfo = {
  tool: "cc-mcp-audit",
  version: "0.0.0-test",
  commitHash: "deadbeef",
};

function makeServerReport(overrides: Partial<ServerReport> = {}): ServerReport {
  return {
    name: "test-server",
    source: "https://github.com/example/test-server",
    commitHash: "abc123def456",
    language: "typescript",
    upstreamPackage: null,
    tools: [
      {
        name: "list_items",
        description: "List items",
        classification: "read",
        sensitiveKeywords: [],
        sourceFile: "server.ts",
        sourceLine: 10,
      },
      {
        name: "delete_item",
        description: "Delete an item",
        classification: "write",
        sensitiveKeywords: ["delete"],
        sourceFile: "server.ts",
        sourceLine: 20,
      },
      {
        name: "mystery",
        description: "Unknown op",
        classification: "unknown",
        sensitiveKeywords: [],
        sourceFile: "server.ts",
        sourceLine: 30,
      },
    ],
    sensitiveToolCount: 1,
    patterns: {
      auth: [{ type: "auth", match: "Bearer", file: "auth.ts", line: 5 }],
      logging: [],
      gates: [],
      stagedExecution: [],
      actorAttribution: [],
      rateLimit: [],
      leastPrivilege: [],
    },
    flags: {
      hasAuth: true,
      hasPerToolAuth: false,
      hasLogging: false,
      hasAttributionIdentifiers: false,
      hasAttributedLogging: false,
      hasConfirmationGates: false,
      hasStagedExecution: false,
      hasWriteTools: true,
      hasRateLimiting: false,
      hasLeastPrivilege: false,
    },
    indicators: {
      authentication: "Present",
      perToolAuth: "Absent",
      readWriteSeparation: "Present",
      leastPrivilege: "Absent",
      confirmationGates: "Absent",
      stagedExecution: "Absent",
      auditLogging: "Absent",
      actorAttribution: "Absent",
      rateLimiting: "Absent",
      sensitiveCapabilityIsolation: "Indeterminate",
      selfModificationPrevention: null,
      subAgentAuthorityConstraints: null,
      permissionBoundaryEnforcement: null,
    },
    accountabilityGaps: [
      {
        pattern: "ungated-write",
        confidence: "high",
        instances: [{ tool: "delete_item", file: "server.ts", line: 20 }],
        reviewNote: "Write tool with no confirmation gate",
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function makeAuditReport(servers?: ServerReport[]): AuditReport {
  const s = servers ?? [makeServerReport(), makeServerReport({ name: "server-2" })];
  return {
    generatedAt: "2026-04-18T00:00:00.000Z",
    schemaVersion: "0.1.0",
    servers: s,
    summary: {
      totalServers: s.length,
      totalTools: s.reduce((acc, srv) => acc + srv.tools.length, 0),
      totalSensitiveTools: s.reduce((acc, srv) => acc + srv.sensitiveToolCount, 0),
      serversWithAuth: s.filter((srv) => srv.flags.hasAuth).length,
      serversWithLogging: s.filter((srv) => srv.flags.hasLogging).length,
      serversWithGates: s.filter((srv) => srv.flags.hasConfirmationGates).length,
    },
  };
}

// -- resolveSourceInfo --

describe("resolveSourceInfo", () => {
  afterEach(() => {
    _resetSourceCache();
  });

  it("returns version matching package.json", () => {
    const info = resolveSourceInfo();
    const pkgPath = resolve(__dirname, "..", "package.json");
    const expected = JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    expect(info.version).toBe(expected);
  });

  it("returns tool field as cc-mcp-audit", () => {
    const info = resolveSourceInfo();
    expect(info.tool).toBe("cc-mcp-audit");
  });

  it("commitHash is a hex string or null", () => {
    const info = resolveSourceInfo();
    if (info.commitHash !== null) {
      expect(info.commitHash).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("caches result across calls", () => {
    const first = resolveSourceInfo();
    const second = resolveSourceInfo();
    expect(first).toBe(second);
  });

  it("cache resets with _resetSourceCache", () => {
    const first = resolveSourceInfo();
    _resetSourceCache();
    const second = resolveSourceInfo();
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe("resolveSourceInfo with broken PATH", () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
    _resetSourceCache();
  });

  it("returns null commitHash when git is not available", () => {
    process.env.PATH = "/nonexistent-path-for-testing";
    const info = resolveSourceInfo();
    expect(info.commitHash).toBeNull();
    expect(info.version).toBeTruthy();
  });
});

describe("resolveSourceInfo with broken package.json", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    const dir = resolve(tmpdir(), `evidence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws descriptive error when package.json is missing", () => {
    tmpDir = makeTmpDir();
    expect(() => resolveSourceInfo(tmpDir)).toThrow(/package\.json not found/);
  });

  it("throws descriptive error when package.json is not valid JSON", () => {
    tmpDir = makeTmpDir();
    writeFileSync(resolve(tmpDir, "package.json"), "not { json", "utf-8");
    expect(() => resolveSourceInfo(tmpDir)).toThrow(/not valid JSON/);
  });

  it("throws descriptive error when package.json has no version field", () => {
    tmpDir = makeTmpDir();
    writeFileSync(resolve(tmpDir, "package.json"), '{"name": "test"}', "utf-8");
    expect(() => resolveSourceInfo(tmpDir)).toThrow(/missing a "version" field/);
  });

  it("throws descriptive error when version is empty string", () => {
    tmpDir = makeTmpDir();
    writeFileSync(resolve(tmpDir, "package.json"), '{"version": ""}', "utf-8");
    expect(() => resolveSourceInfo(tmpDir)).toThrow(/missing a "version" field/);
  });

  it("throws descriptive error when version is not a string", () => {
    tmpDir = makeTmpDir();
    writeFileSync(resolve(tmpDir, "package.json"), '{"version": 123}', "utf-8");
    expect(() => resolveSourceInfo(tmpDir)).toThrow(/missing a "version" field/);
  });
});

// -- toEvidence --

describe("toEvidence", () => {
  it("wraps a ServerReport in an EvidenceEnvelope", () => {
    const envelope = toEvidence(makeServerReport(), fakeSource);

    expect(envelope.evidenceVersion).toBe("0.1.0");
    expect(envelope.source.tool).toBe("cc-mcp-audit");
    expect(envelope.source.version).toBe("0.0.0-test");
    expect(envelope.source.commitHash).toBe("deadbeef");
  });

  it("timestamp is a valid ISO 8601 string", () => {
    const envelope = toEvidence(makeServerReport(), fakeSource);
    const parsed = new Date(envelope.timestamp);
    expect(parsed.toISOString()).toBe(envelope.timestamp);
  });

  it("maps subject from ServerReport fields", () => {
    const envelope = toEvidence(makeServerReport(), fakeSource);

    expect(envelope.subject).toEqual({
      name: "test-server",
      source: "https://github.com/example/test-server",
      commitHash: "abc123def456",
      language: "typescript",
    });
  });

  it("copies indicators into attributes", () => {
    const report = makeServerReport();
    const envelope = toEvidence(report, fakeSource);
    expect(envelope.attributes.indicators).toEqual(report.indicators);
  });

  it("copies gaps into attributes", () => {
    const envelope = toEvidence(makeServerReport(), fakeSource);
    expect(envelope.attributes.gaps).toHaveLength(1);
    expect(envelope.attributes.gaps[0].pattern).toBe("ungated-write");
  });

  it("copies flags into attributes", () => {
    const report = makeServerReport();
    const envelope = toEvidence(report, fakeSource);
    expect(envelope.attributes.flags).toEqual(report.flags);
  });

  it("computes toolSummary from tools array", () => {
    const envelope = toEvidence(makeServerReport(), fakeSource);
    expect(envelope.attributes.toolSummary).toEqual({
      total: 3,
      read: 1,
      write: 1,
      unknown: 1,
      sensitive: 1,
    });
  });

  it("embeds the full ServerReport", () => {
    const report = makeServerReport();
    const envelope = toEvidence(report, fakeSource);
    expect(envelope.fullReport).toBe(report);
  });

  it("handles server with no tools", () => {
    const envelope = toEvidence(
      makeServerReport({ tools: [], sensitiveToolCount: 0 }),
      fakeSource
    );
    expect(envelope.attributes.toolSummary).toEqual({
      total: 0, read: 0, write: 0, unknown: 0, sensitive: 0,
    });
  });

  it("handles null commitHash on server", () => {
    const envelope = toEvidence(
      makeServerReport({ commitHash: null }),
      fakeSource
    );
    expect(envelope.subject.commitHash).toBeNull();
  });

  it("handles empty accountabilityGaps", () => {
    const envelope = toEvidence(
      makeServerReport({ accountabilityGaps: [] }),
      fakeSource
    );
    expect(envelope.attributes.gaps).toEqual([]);
  });

  it("uses resolveSourceInfo when no override provided", () => {
    afterEach(() => _resetSourceCache());
    const envelope = toEvidence(makeServerReport());
    const pkgPath = resolve(__dirname, "..", "package.json");
    const expectedVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    expect(envelope.source.version).toBe(expectedVersion);
  });
});

// -- toEvidenceBatch --

describe("toEvidenceBatch", () => {
  it("wraps an AuditReport in an EvidenceBatch", () => {
    const audit = makeAuditReport();
    const batch = toEvidenceBatch(audit, fakeSource);

    expect(batch.evidenceVersion).toBe("0.1.0");
    expect(batch.generatedAt).toBe("2026-04-18T00:00:00.000Z");
    expect(batch.source).toEqual(fakeSource);
    expect(batch.envelopes).toHaveLength(2);
    expect(batch.summary).toEqual(audit.summary);
  });

  it("creates one envelope per server", () => {
    const batch = toEvidenceBatch(makeAuditReport(), fakeSource);
    expect(batch.envelopes[0].subject.name).toBe("test-server");
    expect(batch.envelopes[1].subject.name).toBe("server-2");
  });

  it("each envelope has matching evidenceVersion", () => {
    const batch = toEvidenceBatch(makeAuditReport(), fakeSource);
    for (const env of batch.envelopes) {
      expect(env.evidenceVersion).toBe("0.1.0");
    }
  });

  it("attributes.indicators matches fullReport.indicators in each envelope", () => {
    const batch = toEvidenceBatch(makeAuditReport(), fakeSource);
    for (const env of batch.envelopes) {
      expect(env.attributes.indicators).toEqual(env.fullReport.indicators);
    }
  });

  it("toolSummary counts match fullReport.tools in each envelope", () => {
    const batch = toEvidenceBatch(makeAuditReport(), fakeSource);
    for (const env of batch.envelopes) {
      const tools = env.fullReport.tools;
      const summary = env.attributes.toolSummary;
      expect(summary.total).toBe(tools.length);
      expect(summary.read).toBe(tools.filter((t) => t.classification === "read").length);
      expect(summary.write).toBe(tools.filter((t) => t.classification === "write").length);
      expect(summary.unknown).toBe(tools.filter((t) => t.classification === "unknown").length);
      expect(summary.sensitive).toBe(env.fullReport.sensitiveToolCount);
    }
  });

  it("handles empty servers list", () => {
    const batch = toEvidenceBatch(makeAuditReport([]), fakeSource);
    expect(batch.envelopes).toEqual([]);
    expect(batch.summary.totalServers).toBe(0);
  });

  it("batch source matches every envelope source", () => {
    const batch = toEvidenceBatch(makeAuditReport(), fakeSource);
    for (const env of batch.envelopes) {
      expect(env.source).toEqual(batch.source);
    }
  });
});

// -- Serialization round-trip --

describe("serialization", () => {
  it("EvidenceEnvelope survives JSON round-trip", () => {
    const report = makeServerReport();
    const envelope = toEvidence(report, fakeSource);
    const roundTripped = JSON.parse(JSON.stringify(envelope));

    expect(roundTripped.evidenceVersion).toBe(envelope.evidenceVersion);
    expect(roundTripped.source).toEqual(envelope.source);
    expect(roundTripped.timestamp).toBe(envelope.timestamp);
    expect(roundTripped.subject).toEqual(envelope.subject);
    expect(roundTripped.attributes.indicators).toEqual(envelope.attributes.indicators);
    expect(roundTripped.attributes.gaps).toEqual(envelope.attributes.gaps);
    expect(roundTripped.attributes.flags).toEqual(envelope.attributes.flags);
    expect(roundTripped.attributes.toolSummary).toEqual(envelope.attributes.toolSummary);
    expect(roundTripped.fullReport.name).toBe(report.name);
    expect(roundTripped.fullReport.indicators).toEqual(report.indicators);
  });

  it("EvidenceBatch survives JSON round-trip", () => {
    const audit = makeAuditReport();
    const batch = toEvidenceBatch(audit, fakeSource);
    const roundTripped = JSON.parse(JSON.stringify(batch));

    expect(roundTripped.evidenceVersion).toBe(batch.evidenceVersion);
    expect(roundTripped.generatedAt).toBe(batch.generatedAt);
    expect(roundTripped.source).toEqual(batch.source);
    expect(roundTripped.envelopes).toHaveLength(batch.envelopes.length);
    expect(roundTripped.summary).toEqual(batch.summary);
    for (let i = 0; i < batch.envelopes.length; i++) {
      expect(roundTripped.envelopes[i].subject).toEqual(batch.envelopes[i].subject);
      expect(roundTripped.envelopes[i].attributes).toEqual(batch.envelopes[i].attributes);
    }
  });

  it("null Domain 5 indicators serialize as JSON null", () => {
    const envelope = toEvidence(makeServerReport(), fakeSource);
    const json = JSON.stringify(envelope);
    const parsed = JSON.parse(json);

    expect(parsed.attributes.indicators.selfModificationPrevention).toBeNull();
    expect(parsed.attributes.indicators.subAgentAuthorityConstraints).toBeNull();
    expect(parsed.attributes.indicators.permissionBoundaryEnforcement).toBeNull();
  });
});

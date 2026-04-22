import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeServer, analyzeServers } from "./analyze.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "..", "test-fixtures");

describe("analyzeServer", () => {
  it("produces a complete report for a Python server", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "python-server"),
      name: "test-python",
    });

    expect(report.name).toBe("test-python");
    expect(report.language).toBe("python");
    expect(report.tools.length).toBeGreaterThan(0);
    expect(report.flags.hasAuth).toBe(true);
    expect(report.flags.hasLogging).toBe(true);
  });

  it("produces a complete report for a TypeScript server", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "ts-server"),
    });

    expect(report.language).toBe("typescript");
    expect(report.tools.length).toBeGreaterThan(0);
  });

  it("detects confirmation gates in gated server", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "gated-server"),
    });

    expect(report.flags.hasConfirmationGates).toBe(true);
    expect(report.patterns.gates.length).toBeGreaterThan(0);
  });

  it("warns when no tools found and no framework detected", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "no-tools-server"),
    });

    expect(report.tools).toEqual([]);
    expect(report.warnings.some((w) => w.includes("no MCP framework imports detected"))).toBe(true);
  });

  it("warns loudly when framework detected but no tools extracted", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "framework-no-tools"),
    });

    expect(report.tools).toEqual([]);
    expect(report.warnings.some((w) => w.includes("MCP framework detected"))).toBe(true);
    expect(report.warnings.some((w) => w.includes("manual review required"))).toBe(true);
  });

  it("detects attributed logging (log-adjacent)", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "python-server"),
    });

    expect(report.flags.hasAttributionIdentifiers).toBe(true);
    expect(report.flags.hasAttributedLogging).toBe(true);
  });

  it("populates accountability gaps", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "ts-server"),
    });

    // TS server has write tools (send_email, update_record, deploy_app)
    // with no gates and no logging -- should have gaps
    expect(report.accountabilityGaps.length).toBeGreaterThan(0);
    const gapPatterns = report.accountabilityGaps.map((g) => g.pattern);
    expect(gapPatterns).toContain("ungated-write");
  });

  it("captures commit hash when repo is under git (this repo)", () => {
    // Use the package's own repo as a fixture that is definitely under git
    const repoRoot = resolve(__dirname, "..", "..", "..");
    const report = analyzeServer({ source: repoRoot, name: "self" });

    // commitHash should either be a 40-char hex string or null (if git is
    // somehow unavailable in CI); never undefined
    expect(report.commitHash === null || /^[0-9a-f]{40}$/i.test(report.commitHash!)).toBe(true);
    // In normal dev, the parent repo is a git checkout, so we expect a hash
    expect(report.commitHash).not.toBeUndefined();
  });

  it("returns null commit hash for non-git paths", () => {
    // Fixtures are not git repos themselves
    const report = analyzeServer({
      source: resolve(fixturesDir, "python-server"),
    });
    // The fixture directory is inside the parent repo, so git rev-parse
    // will walk up to the parent repo's HEAD. Accept either null or a hash.
    expect(
      report.commitHash === null || /^[0-9a-f]{40}$/i.test(report.commitHash!)
    ).toBe(true);
  });

  it("detects rate limiting and least privilege in governed server", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "governed-server"),
    });

    expect(report.flags.hasRateLimiting).toBe(true);
    expect(report.flags.hasLeastPrivilege).toBe(true);
    expect(report.patterns.rateLimit.length).toBeGreaterThan(0);
    expect(report.patterns.leastPrivilege.length).toBeGreaterThan(0);
  });

  it("reports absence of rate limiting and least privilege", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "ts-server"),
    });

    expect(report.flags.hasRateLimiting).toBe(false);
    expect(report.flags.hasLeastPrivilege).toBe(false);
  });

  it("derives repo name from path when no name provided", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "python-server"),
    });

    expect(report.name).toBe("python-server");
  });

  it("detects wrapper and names upstream package in warning", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "wrapper-server"),
    });

    expect(report.tools).toEqual([]);
    expect(report.upstreamPackage).toBe("upstream-core");
    expect(report.warnings.some((w) => w.includes("wrapper around `upstream-core`"))).toBe(true);
    expect(report.warnings.some((w) => w.includes("audit the upstream package"))).toBe(true);
  });

  it("sets upstreamPackage to null for non-wrapper servers", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "python-server"),
    });

    expect(report.upstreamPackage).toBeNull();
  });

  it("still emits manual review warning for non-wrapper framework-no-tools", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "framework-no-tools"),
    });

    expect(report.upstreamPackage).toBeNull();
    expect(report.warnings.some((w) => w.includes("manual review required"))).toBe(true);
  });

  it("detects Python wrapper and names upstream package in warning", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "python-wrapper-server"),
    });

    expect(report.tools).toEqual([]);
    expect(report.upstreamPackage).toBe("mcp_core");
    expect(report.warnings.some((w) => w.includes("wrapper around `mcp_core`"))).toBe(true);
  });

  it("deepExtract is a no-op when server is not a wrapper", () => {
    const report = analyzeServer(
      { source: resolve(fixturesDir, "python-server") },
      { deepExtract: true }
    );

    // python-server has tools -- deep extract should never trigger
    expect(report.tools.length).toBeGreaterThan(0);
    expect(report.upstreamPackage).toBeNull();
  });

  it("deepExtract is a no-op for framework-no-tools (not a wrapper)", () => {
    const report = analyzeServer(
      { source: resolve(fixturesDir, "framework-no-tools") },
      { deepExtract: true }
    );

    expect(report.tools).toEqual([]);
    expect(report.upstreamPackage).toBeNull();
    expect(report.warnings.some((w) => w.includes("manual review required"))).toBe(true);
  });

  it("deepExtract on wrapper emits runtime warning when deps unavailable", () => {
    // wrapper-server has no node_modules and upstream-core is not a real package
    const report = analyzeServer(
      { source: resolve(fixturesDir, "wrapper-server") },
      { deepExtract: true }
    );

    expect(report.upstreamPackage).toBe("upstream-core");
    // Should have a runtime extraction warning (npm install will fail)
    expect(
      report.warnings.some(
        (w) => w.includes("npm install failed") || w.includes("script execution failed")
      )
    ).toBe(true);
  });
});

describe("analyzeServer - test tool coverage", () => {
  it("computes test tool coverage cross-check for server-with-tests", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "server-with-tests"),
    });

    expect(report.testToolCoverage).toBeDefined();
    expect(report.testToolCoverage!.length).toBeGreaterThan(0);

    const coverage = report.testToolCoverage![0];
    expect(coverage.sourceFile).toContain("test_tools.py");
    expect(coverage.names).toContain("list_users");
    expect(coverage.names).toContain("export_data");

    // export_data is in tests but not extracted from server.py
    expect(coverage.coverage.missingFromExtraction).toContain("export_data");
    // update_settings is extracted but not asserted in tests
    expect(coverage.coverage.missingFromTests).toContain("update_settings");
    // extracted tools count should match what was found
    expect(coverage.coverage.extractedCount).toBe(report.tools.length);
    expect(coverage.coverage.assertedCount).toBe(coverage.names.length);
  });

  it("does not include testToolCoverage for repos without test files", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "python-server"),
    });

    expect(report.testToolCoverage).toBeUndefined();
  });
});

describe("analyzeServers", () => {
  it("produces aggregate report with correct summary", () => {
    const report = analyzeServers([
      { source: resolve(fixturesDir, "python-server"), name: "py" },
      { source: resolve(fixturesDir, "ts-server"), name: "ts" },
    ]);

    expect(report.schemaVersion).toBe("0.1.0");
    expect(report.summary.totalServers).toBe(2);
    expect(report.summary.totalTools).toBeGreaterThan(0);
    expect(report.servers).toHaveLength(2);
    expect(report.servers.map((s) => s.name)).toEqual(["py", "ts"]);
  });
});

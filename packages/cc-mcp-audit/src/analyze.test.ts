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

  it("warns when no tools are found", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "no-tools-server"),
    });

    expect(report.tools).toEqual([]);
    expect(report.warnings).toContain(
      "No tools extracted. The server may use an unsupported registration pattern."
    );
  });

  it("derives repo name from path when no name provided", () => {
    const report = analyzeServer({
      source: resolve(fixturesDir, "python-server"),
    });

    expect(report.name).toBe("python-server");
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

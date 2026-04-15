import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanPatterns, assessAuthArchitecture } from "./patterns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "..", "test-fixtures");

describe("scanPatterns", () => {
  describe("Python server with auth module", () => {
    const patterns = scanPatterns(resolve(fixturesDir, "python-server"));

    it("detects auth patterns", () => {
      expect(patterns.auth.length).toBeGreaterThan(0);
    });

    it("finds OAuth/Bearer/scope/permission references", () => {
      const authMatches = patterns.auth.map((p) => p.match);
      const combined = authMatches.join(" ");
      expect(combined).toMatch(/Bearer|scope|Permission|token/i);
    });

    it("detects logging patterns", () => {
      expect(patterns.logging.length).toBeGreaterThan(0);
      const logFiles = patterns.logging.map((p) => p.file);
      expect(logFiles.some((f) => f.includes("server.py"))).toBe(true);
    });

    it("includes file and line info", () => {
      for (const match of patterns.auth) {
        expect(match.file).toBeTruthy();
        expect(match.line).toBeGreaterThan(0);
        expect(match.type).toBe("auth");
      }
    });
  });

  describe("gated server", () => {
    const patterns = scanPatterns(resolve(fixturesDir, "gated-server"));

    it("detects confirmation gates", () => {
      expect(patterns.gates.length).toBeGreaterThan(0);
    });

    it("finds dry_run, confirmation, approval, sandbox, and preview keywords", () => {
      const gateMatches = patterns.gates.map((p) => p.match.toLowerCase());
      const combined = gateMatches.join(" ");
      // Should find at least some of: dry_run, preview, confirmation, approval, sandbox
      expect(combined).toMatch(/dry_run|preview|confirm|approv|sandbox/i);
    });
  });

  describe("no-tools server", () => {
    const patterns = scanPatterns(resolve(fixturesDir, "no-tools-server"));

    it("returns empty results for server without patterns", () => {
      expect(patterns.auth).toEqual([]);
      expect(patterns.logging).toEqual([]);
      expect(patterns.gates).toEqual([]);
    });
  });
});

describe("assessAuthArchitecture", () => {
  it("returns 'none' when no auth patterns exist", () => {
    const result = assessAuthArchitecture(
      { auth: [], logging: [], gates: [] },
      new Set(["tools.py"])
    );
    expect(result).toBe("none");
  });

  it("returns 'global' when auth is in separate files", () => {
    const result = assessAuthArchitecture(
      {
        auth: [{ type: "auth", match: "Bearer", file: "auth.py", line: 1 }],
        logging: [],
        gates: [],
      },
      new Set(["tools.py"])
    );
    expect(result).toBe("global");
  });

  it("returns 'per-tool' when auth is in tool files", () => {
    const result = assessAuthArchitecture(
      {
        auth: [{ type: "auth", match: "scope", file: "tools.py", line: 5 }],
        logging: [],
        gates: [],
      },
      new Set(["tools.py"])
    );
    expect(result).toBe("per-tool");
  });

  it("returns 'unclear' when auth spans both", () => {
    const result = assessAuthArchitecture(
      {
        auth: [
          { type: "auth", match: "Bearer", file: "auth.py", line: 1 },
          { type: "auth", match: "scope", file: "tools.py", line: 5 },
        ],
        logging: [],
        gates: [],
      },
      new Set(["tools.py"])
    );
    expect(result).toBe("unclear");
  });
});

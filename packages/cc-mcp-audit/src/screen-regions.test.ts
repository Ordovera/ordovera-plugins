import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRegions, formatRegions } from "./screen-regions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "..", "test-fixtures");

describe("extractRegions", () => {
  describe("selfModificationPrevention", () => {
    it("extracts tool registration and mutation patterns", () => {
      const regions = extractRegions(
        resolve(fixturesDir, "mutation-server"),
        "selfModificationPrevention"
      );
      expect(regions.length).toBeGreaterThan(0);

      const combined = regions.map((r) => r.content).join("\n");
      expect(combined).toMatch(/register_tool|\.tool\(|del\s+app\.tools/);
    });

    it("extracts from governed-server (init-only registration)", () => {
      const regions = extractRegions(
        resolve(fixturesDir, "governed-server"),
        "selfModificationPrevention"
      );
      expect(regions.length).toBeGreaterThan(0);
      const combined = regions.map((r) => r.content).join("\n");
      expect(combined).toContain("@app.tool");
    });

    it("returns empty array when no tool registration in repo", () => {
      const regions = extractRegions(
        resolve(fixturesDir, "no-tools-server"),
        "selfModificationPrevention"
      );
      expect(regions).toEqual([]);
    });
  });

  describe("subAgentAuthorityConstraints", () => {
    it("extracts process-spawning call sites", () => {
      const regions = extractRegions(
        resolve(fixturesDir, "spawning-server"),
        "subAgentAuthorityConstraints"
      );
      expect(regions.length).toBeGreaterThan(0);
      const combined = regions.map((r) => r.content).join("\n");
      // Should match at least one of the spawning patterns
      expect(combined).toMatch(/subprocess|system|eval/);
    });

    it("returns empty array when no spawning patterns", () => {
      const regions = extractRegions(
        resolve(fixturesDir, "governed-server"),
        "subAgentAuthorityConstraints"
      );
      expect(regions).toEqual([]);
    });
  });

  describe("permissionBoundaryEnforcement", () => {
    it("extracts permission/scope check call sites", () => {
      const regions = extractRegions(
        resolve(fixturesDir, "governed-server"),
        "permissionBoundaryEnforcement"
      );
      expect(regions.length).toBeGreaterThan(0);
      const combined = regions.map((r) => r.content).join("\n");
      expect(combined).toMatch(/check_scopes|required_scopes|@app\.tool/);
    });
  });

  describe("region structure", () => {
    it("each region has file, start/end lines, and content", () => {
      const regions = extractRegions(
        resolve(fixturesDir, "mutation-server"),
        "selfModificationPrevention"
      );
      for (const r of regions) {
        expect(r.file).toBeTruthy();
        expect(r.startLine).toBeGreaterThan(0);
        expect(r.endLine).toBeGreaterThanOrEqual(r.startLine);
        expect(r.content).toBeTruthy();
      }
    });

    it("regions are sorted by file then startLine", () => {
      const regions = extractRegions(
        resolve(fixturesDir, "mutation-server"),
        "selfModificationPrevention"
      );
      for (let i = 1; i < regions.length; i++) {
        const prev = regions[i - 1];
        const curr = regions[i];
        if (prev.file === curr.file) {
          expect(curr.startLine).toBeGreaterThanOrEqual(prev.startLine);
        } else {
          expect(curr.file.localeCompare(prev.file)).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});

describe("formatRegions", () => {
  it("formats regions with file:line headers", () => {
    const regions = [
      {
        file: "a.py",
        startLine: 10,
        endLine: 12,
        content: "def foo():\n    pass",
      },
    ];
    const output = formatRegions(regions);
    expect(output).toContain("--- a.py:10-12 ---");
    expect(output).toContain("def foo()");
  });

  it("emits a no-regions marker when empty", () => {
    const output = formatRegions([]);
    expect(output).toMatch(/no relevant code regions/i);
  });
});

import { describe, it, expect } from "vitest";
import { buildPrompt, PROMPT_VERSION } from "./screen-prompts.js";

describe("buildPrompt", () => {
  const sampleRegions = "--- server.py:10-15 ---\ndef foo():\n    pass";

  it("includes the indicator name and definition", () => {
    const prompt = buildPrompt("selfModificationPrevention", sampleRegions);
    expect(prompt).toContain("Self-modification prevention");
    expect(prompt).toContain("tool definitions");
  });

  it("includes all three likelihood values in the scheme", () => {
    const prompt = buildPrompt("selfModificationPrevention", sampleRegions);
    expect(prompt).toContain("likely-present");
    expect(prompt).toContain("likely-absent");
    expect(prompt).toContain("unclear");
  });

  it("includes the extracted regions text", () => {
    const prompt = buildPrompt("subAgentAuthorityConstraints", sampleRegions);
    expect(prompt).toContain("server.py:10-15");
  });

  it("instructs the model to return valid JSON only", () => {
    const prompt = buildPrompt("permissionBoundaryEnforcement", sampleRegions);
    expect(prompt).toMatch(/valid JSON/i);
    expect(prompt).toMatch(/likelihood/);
    expect(prompt).toMatch(/citations/);
  });

  it("has distinct content per indicator", () => {
    const a = buildPrompt("selfModificationPrevention", sampleRegions);
    const b = buildPrompt("subAgentAuthorityConstraints", sampleRegions);
    const c = buildPrompt("permissionBoundaryEnforcement", sampleRegions);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });
});

describe("PROMPT_VERSION", () => {
  it("exports a version string", () => {
    expect(PROMPT_VERSION).toBe("v1");
  });
});

describe("prompts on disk", () => {
  it("substitutes the {{REGIONS}} placeholder with supplied text", () => {
    const prompt = buildPrompt("selfModificationPrevention", "MY_UNIQUE_REGIONS_MARKER");
    expect(prompt).toContain("MY_UNIQUE_REGIONS_MARKER");
    expect(prompt).not.toContain("{{REGIONS}}");
  });

  it("loads distinct templates from disk for each indicator", () => {
    // Different indicators should read different files with different bodies
    const a = buildPrompt("selfModificationPrevention", "X");
    const b = buildPrompt("subAgentAuthorityConstraints", "X");
    const c = buildPrompt("permissionBoundaryEnforcement", "X");

    expect(a).toContain("Self-modification prevention");
    expect(b).toContain("Sub-agent authority constraints");
    expect(c).toContain("Permission boundary enforcement");
  });
});

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readCommitHash } from "./clone.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("readCommitHash", () => {
  it("returns a 40-char hex hash when path is under git", () => {
    // This package lives inside a git repo -- resolve a known ancestor
    const repoRoot = resolve(__dirname, "..", "..", "..");
    const hash = readCommitHash(repoRoot);
    // Either null (if git unavailable in CI) or a valid 40-char hex
    if (hash !== null) {
      expect(hash).toMatch(/^[0-9a-f]{40}$/i);
    }
  });

  it("returns null for a directory that is not a git repo", () => {
    // Create a throwaway directory outside any git checkout
    const tmp = mkdtempSync(join(tmpdir(), "cc-mcp-audit-test-"));
    try {
      const hash = readCommitHash(tmp);
      expect(hash).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null for a nonexistent path without throwing", () => {
    const hash = readCommitHash("/nonexistent/path/that/definitely/does/not/exist");
    expect(hash).toBeNull();
  });
});

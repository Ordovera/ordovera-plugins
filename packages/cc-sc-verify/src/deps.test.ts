import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { scanPluginDeps } from "./deps.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = resolve(__dirname, "..", "test-fixtures", "tmp-dep-test");

function setup(files: Record<string, string>): void {
  mkdirSync(tmpDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(resolve(tmpDir, name), content);
  }
}

function cleanup(): void {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Already cleaned
  }
}

describe("scanPluginDeps", () => {
  it("reports no deps for clean plugin", async () => {
    setup({});
    try {
      const result = await scanPluginDeps(tmpDir);
      expect(result.has_bundled_deps).toBe(false);
      expect(result.bundled_deps).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("detects package.json with dependencies", async () => {
    setup({
      "package.json": JSON.stringify({
        dependencies: { lodash: "^4.0.0", axios: "^1.0.0" },
        devDependencies: { vitest: "^2.0.0" },
      }),
    });
    try {
      const result = await scanPluginDeps(tmpDir);
      expect(result.has_bundled_deps).toBe(true);
      expect(result.bundled_deps[0].package_manager).toBe("npm");
      expect(result.bundled_deps[0].dep_count).toBe(3);
      expect(result.bundled_deps[0].has_lockfile).toBe(false);
      expect(result.warnings.some((w) => w.includes("3 dependencies"))).toBe(true);
      expect(result.warnings.some((w) => w.includes("no lockfile"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("detects requirements.txt", async () => {
    setup({
      "requirements.txt": "flask==2.0.0\nrequests>=2.28.0\n# comment\n\nsqlalchemy",
    });
    try {
      const result = await scanPluginDeps(tmpDir);
      expect(result.has_bundled_deps).toBe(true);
      expect(result.bundled_deps[0].package_manager).toBe("pip");
      expect(result.bundled_deps[0].dep_count).toBe(3); // 3 non-empty non-comment lines
    } finally {
      cleanup();
    }
  });

  it("detects lockfile presence", async () => {
    setup({
      "package.json": JSON.stringify({ dependencies: { lodash: "^4.0.0" } }),
      "package-lock.json": "{}",
    });
    try {
      const result = await scanPluginDeps(tmpDir);
      expect(result.bundled_deps[0].has_lockfile).toBe(true);
      // Should NOT warn about missing lockfile
      expect(result.warnings.some((w) => w.includes("no lockfile"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("warns about bundled node_modules", async () => {
    setup({ "package.json": JSON.stringify({ dependencies: { a: "1" } }) });
    mkdirSync(resolve(tmpDir, "node_modules"), { recursive: true });
    try {
      const result = await scanPluginDeps(tmpDir);
      expect(result.bundled_deps[0].has_node_modules).toBe(true);
      expect(result.warnings.some((w) => w.includes("node_modules"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("suggests correct audit command per manager", async () => {
    setup({ "requirements.txt": "flask" });
    try {
      const result = await scanPluginDeps(tmpDir);
      expect(result.warnings.some((w) => w.includes("pip-audit"))).toBe(true);
    } finally {
      cleanup();
    }
  });
});

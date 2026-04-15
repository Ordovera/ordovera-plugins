import { describe, it, expect } from "vitest";
import type {
  DriftStatus,
  PluginReport,
  RepoStatus,
  SkillDiff,
  HookDiff,
} from "./types.js";

// Test the diff logic directly since verifyPlugins requires disk + network
// We extract the pure functions for testing

function computeSkillDiff(local: string[], remote: string[]): SkillDiff {
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  return {
    added: remote.filter((s) => !localSet.has(s)),
    removed: local.filter((s) => !remoteSet.has(s)),
  };
}

function computeHookDiff(local: string[], remote: string[]): HookDiff {
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  return {
    added: remote.filter((h) => !localSet.has(h)),
    removed: local.filter((h) => !remoteSet.has(h)),
  };
}

function determineDriftStatus(
  installedSha: string | null,
  remoteSha: string | null
): DriftStatus {
  if (!installedSha || !remoteSha) return "unknown";
  return installedSha === remoteSha ? "current" : "behind";
}

describe("computeSkillDiff", () => {
  it("detects added skills", () => {
    const diff = computeSkillDiff(
      ["context-scaffold", "context-audit"],
      ["context-scaffold", "context-audit", "context-budget"]
    );
    expect(diff.added).toEqual(["context-budget"]);
    expect(diff.removed).toEqual([]);
  });

  it("detects removed skills", () => {
    const diff = computeSkillDiff(
      ["context-scaffold", "context-audit", "context-old"],
      ["context-scaffold", "context-audit"]
    );
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["context-old"]);
  });

  it("detects both added and removed", () => {
    const diff = computeSkillDiff(
      ["skill-a", "skill-b", "skill-c"],
      ["skill-b", "skill-c", "skill-d", "skill-e"]
    );
    expect(diff.added).toEqual(["skill-d", "skill-e"]);
    expect(diff.removed).toEqual(["skill-a"]);
  });

  it("returns empty diffs when identical", () => {
    const diff = computeSkillDiff(
      ["skill-a", "skill-b"],
      ["skill-a", "skill-b"]
    );
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("handles empty local", () => {
    const diff = computeSkillDiff([], ["skill-a", "skill-b"]);
    expect(diff.added).toEqual(["skill-a", "skill-b"]);
    expect(diff.removed).toEqual([]);
  });

  it("handles empty remote", () => {
    const diff = computeSkillDiff(["skill-a", "skill-b"], []);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["skill-a", "skill-b"]);
  });
});

describe("computeHookDiff", () => {
  it("detects added hooks", () => {
    const diff = computeHookDiff(
      ["preflight.py"],
      ["preflight.py", "lint-check.sh"]
    );
    expect(diff.added).toEqual(["lint-check.sh"]);
    expect(diff.removed).toEqual([]);
  });

  it("detects removed hooks", () => {
    const diff = computeHookDiff(
      ["preflight.py", "old-hook.sh"],
      ["preflight.py"]
    );
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["old-hook.sh"]);
  });
});

describe("determineDriftStatus", () => {
  it("returns current when SHAs match", () => {
    expect(determineDriftStatus("abc123", "abc123")).toBe("current");
  });

  it("returns behind when SHAs differ", () => {
    expect(determineDriftStatus("abc123", "def456")).toBe("behind");
  });

  it("returns unknown when installed SHA is null", () => {
    expect(determineDriftStatus(null, "def456")).toBe("unknown");
  });

  it("returns unknown when remote SHA is null", () => {
    expect(determineDriftStatus("abc123", null)).toBe("unknown");
  });

  it("returns unknown when both null", () => {
    expect(determineDriftStatus(null, null)).toBe("unknown");
  });
});

describe("report classification", () => {
  function hasIssues(report: PluginReport): boolean {
    return (
      report.warnings.length > 0 ||
      report.drift_status === "behind" ||
      !report.repo_status.exists
    );
  }

  const okRepo: RepoStatus = {
    exists: true,
    archived: false,
    visibility: "public",
    default_branch: "main",
    owner_changed: false,
    current_owner: "ordovera",
    original_owner: "ordovera",
  };

  it("classifies a current plugin as no-issue", () => {
    const report: PluginReport = {
      plugin_name: "test",
      marketplace: "test-mp",
      repo: "test/test",
      installed_version: "abc",
      installed_at: "2026-01-01",
      last_updated: "2026-01-01",
      installed_sha: "abc123",
      repo_status: okRepo,
      drift_status: "current",
      current_sha: "abc123",
      skill_diff: { added: [], removed: [] },
      hook_diff: { added: [], removed: [] },
      description_changed: false,
      permission_escalation: null,
      integrity: null,
      dep_scan: null,
      dep_audit: null,
      skipped: {},
      warnings: [],
    };
    expect(hasIssues(report)).toBe(false);
  });

  it("classifies a behind plugin as issue", () => {
    const report: PluginReport = {
      plugin_name: "test",
      marketplace: "test-mp",
      repo: "test/test",
      installed_version: "abc",
      installed_at: "2026-01-01",
      last_updated: "2026-01-01",
      installed_sha: "abc123",
      repo_status: okRepo,
      drift_status: "behind",
      current_sha: "def456",
      skill_diff: { added: [], removed: [] },
      hook_diff: { added: [], removed: [] },
      description_changed: false,
      permission_escalation: null,
      integrity: null,
      dep_scan: null,
      dep_audit: null,
      skipped: {},
      warnings: [],
    };
    expect(hasIssues(report)).toBe(true);
  });

  it("classifies a missing repo as issue", () => {
    const report: PluginReport = {
      plugin_name: "test",
      marketplace: "test-mp",
      repo: "test/test",
      installed_version: "abc",
      installed_at: "2026-01-01",
      last_updated: "2026-01-01",
      installed_sha: "abc123",
      repo_status: { ...okRepo, exists: false },
      drift_status: "unknown",
      current_sha: null,
      skill_diff: { added: [], removed: [] },
      hook_diff: { added: [], removed: [] },
      description_changed: false,
      permission_escalation: null,
      integrity: null,
      dep_scan: null,
      dep_audit: null,
      skipped: {},
      warnings: ["Repository not found"],
    };
    expect(hasIssues(report)).toBe(true);
  });
});

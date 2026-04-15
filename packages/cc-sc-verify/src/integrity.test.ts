import { describe, it, expect } from "vitest";
import { compareHashes } from "./integrity.js";
import type { FileHash } from "./integrity.js";

function fh(path: string, hash: string): FileHash {
  return { path, hash, size: 100 };
}

describe("compareHashes", () => {
  it("detects modified files", () => {
    const local = new Map([
      ["scripts/run.py", fh("scripts/run.py", "aaa111")],
    ]);
    const remote = new Map([
      ["scripts/run.py", fh("scripts/run.py", "bbb222")],
    ]);
    const result = compareHashes(local, remote);

    expect(result.content_diffs).toHaveLength(1);
    expect(result.content_diffs[0].type).toBe("modified");
    expect(result.content_diffs[0].path).toBe("scripts/run.py");
  });

  it("detects added files", () => {
    const local = new Map<string, FileHash>();
    const remote = new Map([
      ["scripts/new.py", fh("scripts/new.py", "ccc333")],
    ]);
    const result = compareHashes(local, remote);

    expect(result.content_diffs).toHaveLength(1);
    expect(result.content_diffs[0].type).toBe("added");
    expect(result.new_scripts_upstream).toContain("scripts/new.py");
  });

  it("detects removed files", () => {
    const local = new Map([
      ["scripts/old.sh", fh("scripts/old.sh", "ddd444")],
    ]);
    const remote = new Map<string, FileHash>();
    const result = compareHashes(local, remote);

    expect(result.content_diffs).toHaveLength(1);
    expect(result.content_diffs[0].type).toBe("removed");
    expect(result.removed_scripts_upstream).toContain("scripts/old.sh");
  });

  it("reports no diffs when identical", () => {
    const local = new Map([
      ["scripts/run.py", fh("scripts/run.py", "same")],
      ["skills/my-skill/SKILL.md", fh("skills/my-skill/SKILL.md", "same2")],
    ]);
    const remote = new Map([
      ["scripts/run.py", fh("scripts/run.py", "same")],
      ["skills/my-skill/SKILL.md", fh("skills/my-skill/SKILL.md", "same2")],
    ]);
    const result = compareHashes(local, remote);

    expect(result.content_diffs).toHaveLength(0);
    expect(result.new_scripts_upstream).toHaveLength(0);
    expect(result.removed_scripts_upstream).toHaveLength(0);
  });

  it("handles mixed changes", () => {
    const local = new Map([
      ["scripts/a.py", fh("scripts/a.py", "unchanged")],
      ["scripts/b.py", fh("scripts/b.py", "old_hash")],
      ["scripts/c.sh", fh("scripts/c.sh", "removed_hash")],
    ]);
    const remote = new Map([
      ["scripts/a.py", fh("scripts/a.py", "unchanged")],
      ["scripts/b.py", fh("scripts/b.py", "new_hash")],
      ["scripts/d.py", fh("scripts/d.py", "added_hash")],
    ]);
    const result = compareHashes(local, remote);

    expect(result.content_diffs).toHaveLength(3); // modified b, removed c, added d
    const types = result.content_diffs.map((d) => d.type).sort();
    expect(types).toEqual(["added", "modified", "removed"]);
  });

  it("counts scripts and skills separately", () => {
    const local = new Map([
      ["scripts/run.py", fh("scripts/run.py", "a")],
      ["scripts/build.sh", fh("scripts/build.sh", "b")],
      ["skills/my-skill/SKILL.md", fh("skills/my-skill/SKILL.md", "c")],
    ]);
    const remote = new Map(local);
    const result = compareHashes(local, remote);

    expect(result.scripts_checked).toBe(2);
    expect(result.skills_checked).toBe(1);
  });
});

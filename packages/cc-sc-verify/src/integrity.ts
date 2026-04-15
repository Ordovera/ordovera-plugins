/**
 * File integrity checking for plugin installations.
 *
 * Two modes:
 * 1. Script content hashing -- hash .py/.sh/.js files locally, compare
 *    against remote to detect upstream content changes.
 * 2. Local tampering detection -- verify cached install hasn't been
 *    modified since installation by comparing against the git tree
 *    at the installed SHA.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

// File extensions relevant for security analysis
const SCRIPT_EXTENSIONS = new Set([
  ".py",
  ".sh",
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".bash",
]);

const SKILL_FILENAME = "SKILL.md";

export interface FileHash {
  path: string;
  hash: string;
  size: number;
}

export interface ContentDiff {
  path: string;
  local_hash: string;
  remote_hash: string;
  type: "modified" | "added" | "removed";
}

export interface IntegrityReport {
  scripts_checked: number;
  skills_checked: number;
  content_diffs: ContentDiff[];
  tampered_files: ContentDiff[];
  new_scripts_upstream: string[];
  removed_scripts_upstream: string[];
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex").slice(0, 16);
}

async function walkDir(
  dir: string,
  base: string
): Promise<Array<{ relativePath: string; fullPath: string }>> {
  const results: Array<{ relativePath: string; fullPath: string }> = [];
  if (!existsSync(dir)) return results;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(base, fullPath);

      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      if (entry.isDirectory()) {
        const sub = await walkDir(fullPath, base);
        results.push(...sub);
      } else if (entry.isFile()) {
        results.push({ relativePath, fullPath });
      }
    }
  } catch {
    // Directory unreadable
  }

  return results;
}

function isScriptFile(path: string): boolean {
  const ext = path.slice(path.lastIndexOf("."));
  return SCRIPT_EXTENSIONS.has(ext);
}

function isSkillFile(path: string): boolean {
  return path.endsWith(SKILL_FILENAME);
}

export async function hashLocalFiles(
  installPath: string
): Promise<Map<string, FileHash>> {
  const hashes = new Map<string, FileHash>();
  const files = await walkDir(installPath, installPath);

  for (const { relativePath, fullPath } of files) {
    if (!isScriptFile(relativePath) && !isSkillFile(relativePath)) continue;

    try {
      const content = await readFile(fullPath, "utf-8");
      const stats = await stat(fullPath);
      hashes.set(relativePath, {
        path: relativePath,
        hash: hashContent(content),
        size: stats.size,
      });
    } catch {
      // File unreadable
    }
  }

  return hashes;
}

/**
 * Compare local file hashes against remote file hashes.
 * Used for both upstream change detection and local tampering detection.
 */
export function compareHashes(
  local: Map<string, FileHash>,
  remote: Map<string, FileHash>
): IntegrityReport {
  const contentDiffs: ContentDiff[] = [];
  const newScripts: string[] = [];
  const removedScripts: string[] = [];
  let scriptsChecked = 0;
  let skillsChecked = 0;

  // Check all local files against remote
  for (const [path, localHash] of local) {
    if (isScriptFile(path)) scriptsChecked++;
    if (isSkillFile(path)) skillsChecked++;

    const remoteHash = remote.get(path);
    if (!remoteHash) {
      // File exists locally but not remote -- removed upstream
      if (isScriptFile(path)) {
        removedScripts.push(path);
      }
      contentDiffs.push({
        path,
        local_hash: localHash.hash,
        remote_hash: "",
        type: "removed",
      });
    } else if (localHash.hash !== remoteHash.hash) {
      contentDiffs.push({
        path,
        local_hash: localHash.hash,
        remote_hash: remoteHash.hash,
        type: "modified",
      });
    }
  }

  // Check for files in remote but not local (added upstream)
  for (const [path, remoteHash] of remote) {
    if (!local.has(path)) {
      if (isScriptFile(path)) {
        newScripts.push(path);
      }
      contentDiffs.push({
        path,
        local_hash: "",
        remote_hash: remoteHash.hash,
        type: "added",
      });
    }
  }

  return {
    scripts_checked: scriptsChecked,
    skills_checked: skillsChecked,
    content_diffs: contentDiffs,
    tampered_files: [], // Set by the caller when comparing installed SHA
    new_scripts_upstream: newScripts.sort(),
    removed_scripts_upstream: removedScripts.sort(),
  };
}

/**
 * Fetch file contents from GitHub at a specific SHA and hash them.
 * Used for both upstream comparison (HEAD) and tamper detection (installed SHA).
 */
export async function hashRemoteFiles(
  repo: string,
  ref: string,
  pluginPath: string
): Promise<Map<string, FileHash>> {
  const hashes = new Map<string, FileHash>();

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "cc-sc-verify",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  // Get the tree recursively
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`,
      { headers }
    );
    if (!response.ok) return hashes;

    const tree = (await response.json()) as {
      tree: Array<{ path: string; type: string; sha: string; size?: number }>;
    };

    for (const entry of tree.tree) {
      if (entry.type !== "blob") continue;

      // Filter to plugin path
      let relativePath: string;
      if (pluginPath) {
        if (!entry.path.startsWith(pluginPath + "/")) continue;
        relativePath = entry.path.slice(pluginPath.length + 1);
      } else {
        relativePath = entry.path;
      }

      if (!isScriptFile(relativePath) && !isSkillFile(relativePath)) continue;

      // Fetch blob content
      try {
        const blobResponse = await fetch(
          `https://api.github.com/repos/${repo}/git/blobs/${entry.sha}`,
          { headers }
        );
        if (!blobResponse.ok) continue;

        const blob = (await blobResponse.json()) as {
          content: string;
          encoding: string;
          size: number;
        };
        const content = Buffer.from(blob.content, "base64").toString("utf-8");
        hashes.set(relativePath, {
          path: relativePath,
          hash: hashContent(content),
          size: blob.size,
        });
      } catch {
        // Blob fetch failed
      }
    }
  } catch {
    // Tree fetch failed
  }

  return hashes;
}

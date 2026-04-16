import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

export interface CloneResult {
  localPath: string;
  repoName: string;
  isTemp: boolean;
}

/**
 * Clone an MCP server repo (shallow) or resolve a local path.
 * Returns the local path to analyze.
 */
export function resolveSource(source: string, workDir?: string): CloneResult {
  // Local path — just validate it exists
  if (!source.startsWith("http") && !source.startsWith("git@")) {
    if (!existsSync(source)) {
      throw new Error(`Local path does not exist: ${source}`);
    }
    return {
      localPath: source,
      repoName: basename(source),
      isTemp: false,
    };
  }

  // Remote URL — shallow clone
  const repoName = extractRepoName(source);
  const targetDir = workDir
    ? join(workDir, repoName)
    : join(tmpdir(), "cc-mcp-audit", repoName);

  if (existsSync(targetDir)) {
    return { localPath: targetDir, repoName, isTemp: !workDir };
  }

  mkdirSync(targetDir, { recursive: true });

  try {
    execFileSync("git", ["clone", "--depth", "1", source, targetDir], {
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    throw new Error(
      `Failed to clone ${source}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { localPath: targetDir, repoName, isTemp: !workDir };
}

function extractRepoName(url: string): string {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1] ?? "unknown-repo";
}

/**
 * Read the HEAD commit hash from a local git repository.
 * Returns null if the path is not a git repo, git is unavailable, or the
 * command fails for any reason. Safe for non-git local paths.
 */
export function readCommitHash(repoPath: string): string | null {
  try {
    const output = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 5_000,
    });
    const hash = output.trim();
    return /^[0-9a-f]{40}$/i.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

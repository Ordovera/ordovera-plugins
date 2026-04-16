import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import type { Domain5Indicator } from "./types.js";

/**
 * A contiguous region of code extracted for LLM context, labeled with its
 * source file and line range.
 */
export interface CodeRegion {
  file: string;
  startLine: number;
  endLine: number;
  content: string;
}

/**
 * Approximate characters-per-token ratio for budgeting extraction size.
 * A conservative ~3.5 chars/token leaves headroom for prompt overhead.
 */
const CHARS_PER_TOKEN = 3.5;
const MAX_TOKENS_PER_INDICATOR = 8000;
const MAX_CHARS = MAX_TOKENS_PER_INDICATOR * CHARS_PER_TOKEN;

// Patterns whose matches indicate code relevant to self-modification
const REGISTRATION_PATTERNS: RegExp[] = [
  /@\w+\.tool\b/,                    // decorator: @server.tool
  /\.tool\(\s*["']/,                 // call: server.tool("name"
  /Tool\(\s*name\s*=/,               // class: Tool(name="...")
  /register_tool\b/i,
  /add_tool\b/i,
  /update_tool\b/i,
  /remove_tool\b/i,
  /tools\[\s*["']/,                  // dict/object index assignment
  /tools\.append\b/,
  /tools\.update\b/,
  /setattr\s*\([^,]*tools?/i,
  /del\s+\w*tools?\[/i,
];

// Patterns indicating sub-agent spawning / delegation
const SPAWN_PATTERNS: RegExp[] = [
  // Python
  /\bsubprocess\.\w+/,
  /\bos\.system\b/,
  /\bos\.exec\w+/,
  /\bos\.popen\b/,
  /\bos\.spawn\w+/,
  /\beval\s*\(/,
  /\bexec\s*\(/,
  /asyncio\.create_subprocess_\w+/,
  /asyncio\.subprocess\b/,
  // TypeScript / Node
  /child_process/,
  /worker_threads/,
  /\bnew\s+Worker\b/,
  /\.spawn\s*\(/,
  /\.exec\s*\(/,
  /\.fork\s*\(/,
  // MCP client instantiation (cross-tool delegation)
  /new\s+Client\s*\(/,
  /Client\s*\(/,
  /ClientSession\b/,
];

// Patterns indicating permission/scope check logic
const PERMISSION_CHECK_PATTERNS: RegExp[] = [
  /check[_-]?(?:scope|permission|auth|access)/i,
  /require[_-]?(?:scope|permission|auth)/i,
  /verify[_-]?(?:scope|permission|auth)/i,
  /has[_-]?(?:scope|permission|access)/i,
  /@\w*require\w*/,                  // decorators like @require_scope
  /@\w*auth\w*/,                     // decorators like @authenticated
  /@\w*permission\w*/,                // decorators like @permission_required
  /if\s+not\s+\w*\.?\w*(?:scope|permission|auth)/i,
  /raise\s+\w*(?:Permission|Auth)\w*Error/,
  /throw\s+new\s+\w*(?:Permission|Auth)\w*Error/,
];

// Tool handler entry-point patterns (where permission checks would live)
const HANDLER_ENTRY_PATTERNS: RegExp[] = [
  /@\w+\.tool\b/,                    // right before async def
  /\.tool\(\s*["']/,
];

/**
 * Extract code regions relevant to a Domain 5 indicator.
 * Returns a list of regions, truncated to fit within the per-indicator budget.
 */
export function extractRegions(
  repoPath: string,
  indicator: Domain5Indicator
): CodeRegion[] {
  const patterns = patternsForIndicator(indicator);
  const contextLines = contextForIndicator(indicator);
  const regions: CodeRegion[] = [];
  const sourceFiles = findSourceFiles(repoPath);

  for (const filePath of sourceFiles) {
    const content = readFileSync(filePath, "utf-8");
    const relPath = relative(repoPath, filePath);
    const lines = content.split("\n");

    // Find all matching lines
    const matches: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        if (pattern.test(lines[i])) {
          matches.push(i);
          break;
        }
      }
    }

    // Merge overlapping context windows into distinct regions
    const merged = mergeContextWindows(matches, contextLines, lines.length);
    for (const [start, end] of merged) {
      regions.push({
        file: relPath,
        startLine: start + 1,
        endLine: end + 1,
        content: lines.slice(start, end + 1).join("\n"),
      });
    }
  }

  return truncateRegions(regions);
}

function patternsForIndicator(indicator: Domain5Indicator): RegExp[] {
  switch (indicator) {
    case "selfModificationPrevention":
      return REGISTRATION_PATTERNS;
    case "subAgentAuthorityConstraints":
      return SPAWN_PATTERNS;
    case "permissionBoundaryEnforcement":
      return [...PERMISSION_CHECK_PATTERNS, ...HANDLER_ENTRY_PATTERNS];
  }
}

function contextForIndicator(indicator: Domain5Indicator): number {
  switch (indicator) {
    case "selfModificationPrevention":
      return 10;
    case "subAgentAuthorityConstraints":
      return 5;
    case "permissionBoundaryEnforcement":
      return 15;
  }
}

/**
 * Given sorted match line indices, produce merged [start, end] ranges
 * that cover each match plus `contextLines` on either side, merging
 * any overlapping windows.
 */
function mergeContextWindows(
  matches: number[],
  contextLines: number,
  totalLines: number
): Array<[number, number]> {
  if (matches.length === 0) return [];

  const windows: Array<[number, number]> = matches.map((m) => [
    Math.max(0, m - contextLines),
    Math.min(totalLines - 1, m + contextLines),
  ]);

  // Sort by start, merge overlaps
  windows.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of windows) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}

/**
 * Truncate regions to stay within the per-indicator character budget.
 * Keeps the largest regions first (they contain the most signal).
 */
function truncateRegions(regions: CodeRegion[]): CodeRegion[] {
  // Sort by size descending so we keep the largest regions
  const sorted = [...regions].sort(
    (a, b) => b.content.length - a.content.length
  );

  const kept: CodeRegion[] = [];
  let totalChars = 0;
  for (const region of sorted) {
    if (totalChars + region.content.length > MAX_CHARS) continue;
    kept.push(region);
    totalChars += region.content.length;
  }

  // Restore file/line order for readability in the prompt
  kept.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.startLine - b.startLine;
  });

  return kept;
}

function findSourceFiles(dir: string, depth = 0): string[] {
  if (depth > 6) return [];
  const files: string[] = [];
  const skipDirs = new Set([
    "node_modules", ".git", "dist", "build", "__pycache__",
    ".venv", "venv", ".tox", ".mypy_cache",
  ]);

  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") && entry !== ".") continue;
    if (skipDirs.has(entry)) continue;

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath, { throwIfNoEntry: false });
    if (!stat) continue;

    if (stat.isDirectory()) {
      files.push(...findSourceFiles(fullPath, depth + 1));
    } else {
      const ext = extname(entry);
      if ([".py", ".ts", ".js", ".mjs"].includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Format regions as a single string suitable for inclusion in a prompt.
 */
export function formatRegions(regions: CodeRegion[]): string {
  if (regions.length === 0) return "[no relevant code regions extracted]";

  const parts: string[] = [];
  for (const r of regions) {
    parts.push(`--- ${r.file}:${r.startLine}-${r.endLine} ---`);
    parts.push(r.content);
    parts.push("");
  }
  return parts.join("\n");
}

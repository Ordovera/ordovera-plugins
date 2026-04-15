import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import type { PatternMatch } from "./types.js";

interface PatternDef {
  type: PatternMatch["type"];
  patterns: RegExp[];
}

const AUTH_PATTERNS: RegExp[] = [
  /OAuth/i,
  /Bearer/i,
  /api[_-]?key/i,
  /auth(?:orize|enticate|entication)/i,
  /permission/i,
  /\bscope\b/i,
  /access[_-]?control/i,
  /\btoken\b/i,
  /credential/i,
  /\brbac\b/i,
  /role[_-]?check/i,
];

const LOGGING_PATTERNS: RegExp[] = [
  /logging\.\w+/,
  /logger\.\w+/,
  /\blog\.\w+/,
  /console\.log/,
  /audit[_-]?log/i,
  /\btelemetry\b/i,
  /\btracing\b/i,
  /span\.set/i,
];

const GATE_PATTERNS: RegExp[] = [
  /confirm(?:ation)?/i,
  /approv(?:e|al)/i,
  /\bdry[_-]?run\b/i,
  /\bsimulat/i,
  /\bpreview\b/i,
  /\bsandbox\b/i,
  /\bsafe[_-]?mode\b/i,
  /read[_-]?only/i,
  /\bvalidat(?:e|ion)\b.*before/i,
];

const PATTERN_DEFS: PatternDef[] = [
  { type: "auth", patterns: AUTH_PATTERNS },
  { type: "logging", patterns: LOGGING_PATTERNS },
  { type: "gate", patterns: GATE_PATTERNS },
];

export interface PatternResults {
  auth: PatternMatch[];
  logging: PatternMatch[];
  gates: PatternMatch[];
}

/**
 * Scan a repo for auth, logging, and confirmation gate patterns.
 */
export function scanPatterns(repoPath: string): PatternResults {
  const results: PatternResults = { auth: [], logging: [], gates: [] };
  const sourceFiles = findScanFiles(repoPath);

  for (const filePath of sourceFiles) {
    const content = readFileSync(filePath, "utf-8");
    const relPath = relative(repoPath, filePath);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments-only lines for lower noise
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

      for (const def of PATTERN_DEFS) {
        for (const pattern of def.patterns) {
          const match = line.match(pattern);
          if (match) {
            const key = def.type === "gate" ? "gates" : def.type;
            results[key].push({
              type: def.type,
              match: match[0],
              file: relPath,
              line: i + 1,
            });
            break; // One match per pattern type per line
          }
        }
      }
    }
  }

  return results;
}

/**
 * Detect whether auth appears to be per-tool or global.
 * Heuristic: if auth patterns appear in the same files as tool definitions,
 * there may be per-tool auth. If auth is concentrated in separate files,
 * it's likely global.
 */
export function assessAuthArchitecture(
  patterns: PatternResults,
  toolFiles: Set<string>
): "per-tool" | "global" | "none" | "unclear" {
  if (patterns.auth.length === 0) return "none";

  const authFiles = new Set(patterns.auth.map((p) => p.file));
  const overlap = [...authFiles].filter((f) => toolFiles.has(f));

  if (overlap.length === 0) return "global";
  if (overlap.length === authFiles.size) return "per-tool";
  return "unclear";
}

function findScanFiles(dir: string, depth = 0): string[] {
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
      files.push(...findScanFiles(fullPath, depth + 1));
    } else {
      const ext = extname(entry);
      if ([".py", ".ts", ".js", ".mjs", ".json"].includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

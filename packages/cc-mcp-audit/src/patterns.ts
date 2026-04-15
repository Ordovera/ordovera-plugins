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

const ACTOR_ATTRIBUTION_PATTERNS: RegExp[] = [
  /session[_-]?id/i,
  /user[_-]?id/i,
  /\bprincipal\b/i,
  /\bcaller\b/i,
  /auth\.user/i,
  /context\.user/i,
  /\bactor\b/i,
  /request\.user/i,
  /current[_-]?user/i,
  /authenticated[_-]?user/i,
];

const MCP_FRAMEWORK_IMPORTS: RegExp[] = [
  // Python
  /from\s+mcp\s+import/,
  /from\s+mcp\.server/,
  /import\s+mcp/,
  /from\s+fastmcp/,
  /import\s+fastmcp/,
  // TypeScript/JavaScript
  /@modelcontextprotocol\/sdk/,
  /from\s+["']mcp["']/,
  /require\(["']mcp["']\)/,
  /from\s+["']fastmcp["']/,
];

export interface PatternResults {
  auth: PatternMatch[];
  logging: PatternMatch[];
  gates: PatternMatch[];
  actorAttribution: PatternMatch[];
}

/**
 * Scan a repo for auth, logging, confirmation gate, and actor attribution patterns.
 */
export function scanPatterns(repoPath: string): PatternResults {
  const results: PatternResults = { auth: [], logging: [], gates: [], actorAttribution: [] };
  const sourceFiles = findScanFiles(repoPath);

  for (const filePath of sourceFiles) {
    const content = readFileSync(filePath, "utf-8");
    const relPath = relative(repoPath, filePath);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment-only lines and string-only lines for lower noise
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;
      if (isStringLiteral(trimmed)) continue;

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

      // Actor attribution: check if logging lines also reference a principal
      for (const pattern of ACTOR_ATTRIBUTION_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          results.actorAttribution.push({
            type: "logging",
            match: match[0],
            file: relPath,
            line: i + 1,
          });
          break;
        }
      }
    }
  }

  return results;
}

/**
 * Detect MCP framework imports in a repo.
 * Used to warn when a server imports an MCP framework but zero tools were extracted.
 */
export function detectFrameworkImports(repoPath: string): string[] {
  const frameworks: string[] = [];
  const sourceFiles = findScanFiles(repoPath);

  for (const filePath of sourceFiles) {
    const content = readFileSync(filePath, "utf-8");
    const relPath = relative(repoPath, filePath);

    for (const pattern of MCP_FRAMEWORK_IMPORTS) {
      if (pattern.test(content)) {
        const match = content.match(pattern);
        frameworks.push(`${match?.[0]} (${relPath})`);
        break; // One match per file is enough
      }
    }
  }

  return frameworks;
}

/**
 * Check if a trimmed line is purely a string literal (docstring, comment-like string).
 * Reduces false positives from patterns matching inside string content.
 */
function isStringLiteral(trimmed: string): boolean {
  // Python docstrings
  if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) return true;
  // Lines that are just a quoted string (e.g., description assignment value on its own line)
  if (/^["'][^"']*["'],?\s*$/.test(trimmed)) return true;
  return false;
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

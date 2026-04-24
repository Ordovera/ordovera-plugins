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

/**
 * Confirmation gates: explicit user-action-required approval flows.
 * The agent or user must take a distinct step before execution proceeds.
 */
const GATE_PATTERNS: RegExp[] = [
  /confirm(?:ation)?/i,
  /approv(?:e|al)/i,
];

/**
 * Staged/reversible execution: mechanisms that let a call run in a safe
 * mode producing no real effect (or a reversible effect). These enable
 * preview-before-commit or undo semantics, distinct from approval flows.
 */
const STAGED_EXECUTION_PATTERNS: RegExp[] = [
  /\bdry[_-]?run\b/i,
  /\bsimulat/i,
  /\bpreview\b/i,
  /\bsandbox\b/i,
  /\bsafe[_-]?mode\b/i,
  /read[_-]?only/i,
  /\bvalidat(?:e|ion)\b.*before/i,
  /\brollback\b/i,
  /\bundo\b/i,
  /\brevert\b/i,
];

const RATE_LIMIT_PATTERNS: RegExp[] = [
  /rate[_-]?limit/i,
  /\bthrottl/i,
  /RateLimiter/,
  /\bslowapi\b/i,
  /requests[_-]?per[_-]?(?:second|minute|hour)/i,
  /\bbucket\b.*\btoken\b/i,
  /\bmax[_-]?requests\b/i,
  /\bcooldown\b/i,
  /\bdebounce\b/i,
];

const LEAST_PRIVILEGE_PATTERNS: RegExp[] = [
  // OAuth / permission scope configuration
  /\bscopes?\s*[=:]\s*\[/i,
  /required[_-]?scopes?/i,
  /allowed[_-]?(?:scopes?|permissions?|operations?)/i,
  /permission[_-]?(?:set|list|map|config)/i,
  // Capability restriction
  /\ballow[_-]?list/i,
  /\bdeny[_-]?list/i,
  /\bwhitelist/i,
  /\bblacklist/i,
  // Tool-level access control
  /tool[_-]?permissions?/i,
  /capability[_-]?(?:check|grant|restrict)/i,
  /\brestrict(?:ed)?[_-]?tools?\b/i,
  // Namespace / isolation
  /namespace[_-]?(?:isolat|restrict|scope)/i,
];

const PATTERN_DEFS: PatternDef[] = [
  { type: "auth", patterns: AUTH_PATTERNS },
  { type: "logging", patterns: LOGGING_PATTERNS },
  { type: "gate", patterns: GATE_PATTERNS },
  { type: "stagedExecution", patterns: STAGED_EXECUTION_PATTERNS },
  { type: "rateLimit", patterns: RATE_LIMIT_PATTERNS },
  { type: "leastPrivilege", patterns: LEAST_PRIVILEGE_PATTERNS },
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
  // Go
  /github\.com\/modelcontextprotocol\/go-sdk/,
  /github\.com\/mark3labs\/mcp-go/,
  /mcp\.Tool\{/,
];

export interface PatternResults {
  auth: PatternMatch[];
  logging: PatternMatch[];
  gates: PatternMatch[];
  stagedExecution: PatternMatch[];
  actorAttribution: PatternMatch[];
  rateLimit: PatternMatch[];
  leastPrivilege: PatternMatch[];
}

/**
 * Scan a repo for auth, logging, confirmation gate, and actor attribution patterns.
 */
export function scanPatterns(repoPath: string): PatternResults {
  const results: PatternResults = { auth: [], logging: [], gates: [], stagedExecution: [], actorAttribution: [], rateLimit: [], leastPrivilege: [] };
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
            const keyMap: Record<string, keyof PatternResults> = {
              auth: "auth", logging: "logging", gate: "gates",
              stagedExecution: "stagedExecution",
              rateLimit: "rateLimit", leastPrivilege: "leastPrivilege",
            };
            const key = keyMap[def.type] ?? (def.type as keyof PatternResults);
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

      // Actor attribution: track all principal identifier occurrences
      for (const pattern of ACTOR_ATTRIBUTION_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          results.actorAttribution.push({
            type: "attribution",
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
 * Determine whether log statements carry principal identifiers.
 * Stricter than raw actorAttribution count: requires attribution matches
 * to be on the same line as a logging match, or within 3 lines in the same file.
 */
export function hasLogAdjacentAttribution(
  patterns: PatternResults
): boolean {
  if (patterns.logging.length === 0 || patterns.actorAttribution.length === 0) {
    return false;
  }

  // Build a lookup: file -> set of logging line numbers
  const logLinesByFile = new Map<string, number[]>();
  for (const log of patterns.logging) {
    const lines = logLinesByFile.get(log.file) ?? [];
    lines.push(log.line);
    logLinesByFile.set(log.file, lines);
  }

  // Check if any attribution match is within 3 lines of a logging match in the same file
  const proximity = 3;
  for (const attr of patterns.actorAttribution) {
    const logLines = logLinesByFile.get(attr.file);
    if (!logLines) continue;
    for (const logLine of logLines) {
      if (Math.abs(attr.line - logLine) <= proximity) {
        return true;
      }
    }
  }

  return false;
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
  const skipFiles = new Set([
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  ]);

  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") && entry !== ".") continue;
    if (skipDirs.has(entry)) continue;
    if (skipFiles.has(entry)) continue;

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath, { throwIfNoEntry: false });
    if (!stat) continue;

    if (stat.isDirectory()) {
      files.push(...findScanFiles(fullPath, depth + 1));
    } else {
      const ext = extname(entry);
      if ([".py", ".ts", ".js", ".mjs", ".json", ".go"].includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

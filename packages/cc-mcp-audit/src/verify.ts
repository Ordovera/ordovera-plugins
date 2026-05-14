/**
 * LLM verification layer for MCP server analysis.
 *
 * Runs after deterministic analysis to:
 *   1. Verify whether a repo is actually an MCP server
 *   2. Extract tools from unrecognized registration patterns
 *   3. Validate read/write classification of extracted tools
 *
 * Uses Claude Opus via Claude Code CLI (Max subscription).
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtractedTool, ServerReport } from "./types.js";
import type { ModelProvider, ModelCallResult } from "./screen-providers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerifyResult {
  isMcpServer: boolean;
  confidence: "high" | "medium" | "low";
  evidence: string;
  tools: VerifiedTool[];
  extractionNotes: string;
  metadata: VerifyMetadata;
}

export interface VerifiedTool {
  name: string;
  description: string;
  classification: "read" | "write" | "unknown";
  writeRationale: string | null;
  sourceFile: string;
  sourceLine: number;
}

export interface VerifyMetadata {
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  regionsIncluded: number;
  totalCharsSubmitted: number;
}

// ---------------------------------------------------------------------------
// Context extraction
// ---------------------------------------------------------------------------

interface CodeRegion {
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  priority: number; // lower = more important
}

const CHARS_PER_TOKEN = 3.5;
const MAX_CONTEXT_TOKENS = 30_000; // Opus has 200K context; use 30K for source
const MAX_CHARS = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__", ".venv",
  "venv", ".tox", ".mypy_cache", ".pytest_cache", "vendor", ".next",
  "coverage", ".nyc_output", "test-fixtures", "tests", "__tests__",
]);

const SOURCE_EXTS = new Set([".ts", ".js", ".mjs", ".py", ".go"]);

/** Patterns that indicate a file is MCP-relevant */
const MCP_IMPORT_PATTERNS = [
  /from\s+["']@modelcontextprotocol\/sdk/,
  /require\s*\(\s*["']@modelcontextprotocol\/sdk/,
  /from\s+["']mcp/,
  /import\s+["']mcp/,
  /from\s+fastmcp/,
  /from\s+mcp\.server/,
  /mcp-go/,
  /mark3labs\/mcp-go/,
  /metoro-io\/mcp-golang/,
  /github\.com\/modelcontextprotocol/,
  /@server\.tool/,
  /@mcp\.tool/,
  /\.tool\(\s*["']/,
  /ListToolsRequestSchema/,
  /tools\/list/,
  /McpServer/i,
  /FastMCP/,
];

/** Files to always include if they exist (high priority) */
const PRIORITY_FILES = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "go.mod",
  "Cargo.toml",
  "README.md",
];

/** Server entry point filename patterns */
const ENTRY_PATTERNS = [
  /^(?:server|main|index|app|__init__|__main__)\.[^.]+$/,
  /mcp.*\.[^.]+$/i,
  /^src\/(?:server|main|index|app)\.[^.]+$/,
];

/**
 * Extract code regions from a repository for LLM verification.
 *
 * Strategy:
 *   1. Always include dependency manifests (package.json, pyproject.toml, etc.)
 *   2. Include README (truncated to first 100 lines)
 *   3. Include files that import MCP-related packages
 *   4. Include likely entry points (server.ts, main.py, etc.)
 *   5. Fill remaining budget with other source files sorted by relevance
 */
export function extractVerifyRegions(repoPath: string): CodeRegion[] {
  const regions: CodeRegion[] = [];
  const seen = new Set<string>();

  // Phase 1: Priority files (manifests + README)
  for (const name of PRIORITY_FILES) {
    const fullPath = join(repoPath, name);
    if (!existsSync(fullPath)) continue;
    // Also check common subdirectory patterns
    addFileRegion(regions, seen, repoPath, fullPath, 0, name === "README.md" ? 100 : undefined);
  }

  // Also check src/ subdirectory for manifests
  const srcManifests = ["src/package.json", "src/pyproject.toml"];
  for (const rel of srcManifests) {
    const fullPath = join(repoPath, rel);
    if (existsSync(fullPath)) {
      addFileRegion(regions, seen, repoPath, fullPath, 0);
    }
  }

  // Phase 2: Walk source files, categorize by MCP relevance
  const mcpFiles: Array<{ path: string; priority: number }> = [];
  const otherFiles: Array<{ path: string; priority: number }> = [];

  walkSourceFiles(repoPath, (filePath) => {
    const relPath = relative(repoPath, filePath);
    if (seen.has(relPath)) return;

    const content = safeRead(filePath);
    if (!content) return;

    // Check if this file has MCP imports or tool registration
    const isMcpRelevant = MCP_IMPORT_PATTERNS.some((p) => p.test(content));
    const isEntryPoint = ENTRY_PATTERNS.some((p) => p.test(basename(filePath)));

    if (isMcpRelevant) {
      mcpFiles.push({ path: filePath, priority: isEntryPoint ? 1 : 2 });
    } else if (isEntryPoint) {
      mcpFiles.push({ path: filePath, priority: 3 });
    } else {
      otherFiles.push({ path: filePath, priority: 5 });
    }
  });

  // Sort by priority (lower = more important)
  mcpFiles.sort((a, b) => a.priority - b.priority);

  // Phase 3: Add MCP-relevant files first
  for (const f of mcpFiles) {
    addFileRegion(regions, seen, repoPath, f.path, f.priority);
  }

  // Phase 4: Fill remaining budget with other source files
  for (const f of otherFiles) {
    addFileRegion(regions, seen, repoPath, f.path, f.priority);
  }

  // Trim to budget
  return trimToBudget(regions, MAX_CHARS);
}

function addFileRegion(
  regions: CodeRegion[],
  seen: Set<string>,
  repoPath: string,
  filePath: string,
  priority: number,
  maxLines?: number
): void {
  const relPath = relative(repoPath, filePath);
  if (seen.has(relPath)) return;
  seen.add(relPath);

  const content = safeRead(filePath);
  if (!content) return;

  const lines = content.split("\n");
  const end = maxLines ? Math.min(lines.length, maxLines) : lines.length;
  const truncated = lines.slice(0, end).join("\n");

  regions.push({
    file: relPath,
    startLine: 1,
    endLine: end,
    content: truncated,
    priority,
  });
}

function walkSourceFiles(dir: string, callback: (path: string) => void, depth = 0): void {
  if (depth > 5) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;

    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, callback, depth + 1);
    } else if (SOURCE_EXTS.has(extname(entry.name))) {
      callback(full);
    }
  }
}

function safeRead(path: string): string | null {
  try {
    const stat = statSync(path);
    if (stat.size > 200_000) return null; // Skip very large files
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function trimToBudget(regions: CodeRegion[], maxChars: number): CodeRegion[] {
  // Sort by priority (keep most important first)
  const sorted = [...regions].sort((a, b) => a.priority - b.priority);

  const result: CodeRegion[] = [];
  let totalChars = 0;

  for (const region of sorted) {
    const overhead = 50; // file header, line numbers
    const regionChars = region.content.length + overhead;

    if (totalChars + regionChars > maxChars) {
      // Try to include a truncated version
      const remaining = maxChars - totalChars - overhead;
      if (remaining > 500) {
        const truncatedLines = region.content.split("\n");
        let truncatedContent = "";
        for (const line of truncatedLines) {
          if (truncatedContent.length + line.length + 1 > remaining) break;
          truncatedContent += line + "\n";
        }
        if (truncatedContent.length > 100) {
          result.push({
            ...region,
            content: truncatedContent + "\n[... truncated ...]",
            endLine: region.startLine + truncatedContent.split("\n").length - 1,
          });
        }
      }
      break;
    }

    result.push(region);
    totalChars += regionChars;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function promptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "prompts", "v1");
}

let cachedTemplate: string | null = null;

function loadVerifyTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  const path = join(promptsDir(), "verify_mcp_server.txt");
  cachedTemplate = readFileSync(path, "utf-8");
  return cachedTemplate;
}

export function formatVerifyRegions(regions: CodeRegion[]): string {
  return regions
    .map((r) => {
      const header = `--- ${r.file} (lines ${r.startLine}-${r.endLine}) ---`;
      // Add line numbers
      const numbered = r.content
        .split("\n")
        .map((line, i) => `${r.startLine + i}: ${line}`)
        .join("\n");
      return `${header}\n${numbered}`;
    })
    .join("\n\n");
}

export function buildVerifyPrompt(regions: CodeRegion[]): string {
  const template = loadVerifyTemplate();
  const regionsText = formatVerifyRegions(regions);
  return template.replace("{{REGIONS}}", regionsText);
}

// ---------------------------------------------------------------------------
// Verification runner
// ---------------------------------------------------------------------------

/**
 * Run LLM verification on a cloned MCP server repository.
 */
export async function verifyServer(
  repoPath: string,
  provider: ModelProvider
): Promise<VerifyResult> {
  const regions = extractVerifyRegions(repoPath);

  if (regions.length === 0) {
    return {
      isMcpServer: false,
      confidence: "high",
      evidence: "No source files found in repository.",
      tools: [],
      extractionNotes: "Repository appears empty or contains no recognized source files.",
      metadata: {
        model: provider.model,
        promptVersion: "v1",
        inputTokens: 0,
        outputTokens: 0,
        regionsIncluded: 0,
        totalCharsSubmitted: 0,
      },
    };
  }

  const prompt = buildVerifyPrompt(regions);
  const totalChars = regions.reduce((n, r) => n + r.content.length, 0);

  const result: ModelCallResult = await provider.call(prompt);

  // Parse the JSON response
  let parsed: {
    isMcpServer: boolean;
    confidence: string;
    evidence: string;
    tools: Array<{
      name: string;
      description: string;
      classification: string;
      writeRationale: string | null;
      sourceFile: string;
      sourceLine: number;
    }>;
    extractionNotes: string;
  };

  try {
    // Strip markdown code fences if present
    let text = result.text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    parsed = JSON.parse(text);
  } catch {
    return {
      isMcpServer: false,
      confidence: "low",
      evidence: `LLM response was not valid JSON: ${result.text.slice(0, 200)}`,
      tools: [],
      extractionNotes: "Verification failed due to unparseable LLM response.",
      metadata: {
        model: provider.model,
        promptVersion: "v1",
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
        regionsIncluded: regions.length,
        totalCharsSubmitted: totalChars,
      },
    };
  }

  return {
    isMcpServer: parsed.isMcpServer,
    confidence: parsed.confidence as "high" | "medium" | "low",
    evidence: parsed.evidence,
    tools: (parsed.tools || []).map((t) => ({
      name: t.name,
      description: t.description || "",
      classification: (t.classification as "read" | "write" | "unknown") || "unknown",
      writeRationale: t.writeRationale || null,
      sourceFile: t.sourceFile || "",
      sourceLine: t.sourceLine || 0,
    })),
    extractionNotes: parsed.extractionNotes || "",
    metadata: {
      model: provider.model,
      promptVersion: "v1",
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
      regionsIncluded: regions.length,
      totalCharsSubmitted: totalChars,
    },
  };
}

/**
 * Convert LLM-verified tools to ExtractedTool format for merging into ServerReport.
 */
export function verifiedToolsToExtracted(tools: VerifiedTool[]): ExtractedTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    classification: t.classification,
    writeSignals: t.writeRationale ? [t.writeRationale] : [],
    sensitivity: "unknown" as const,
    sensitivityCategory: null,
    sensitivitySignals: [],
    sourceFile: t.sourceFile || "[llm-extracted]",
    sourceLine: t.sourceLine || 0,
  }));
}

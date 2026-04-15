import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import type { ExtractedTool } from "./types.js";

const WRITE_KEYWORDS = [
  "create", "insert", "update", "delete", "drop", "alter", "execute",
  "send", "write", "modify", "remove", "destroy", "post", "put", "patch",
  "publish", "deploy", "push", "upload", "mutate", "truncate",
];

const READ_KEYWORDS = [
  "get", "list", "read", "fetch", "query", "search", "find", "select",
  "describe", "show", "view", "check", "inspect", "count", "status",
];

/**
 * Walk a repo and extract MCP tool definitions from source files.
 */
export function extractTools(repoPath: string): ExtractedTool[] {
  const tools: ExtractedTool[] = [];
  const sourceFiles = findSourceFiles(repoPath);

  for (const filePath of sourceFiles) {
    const content = readFileSync(filePath, "utf-8");
    const ext = extname(filePath);
    const relPath = relative(repoPath, filePath);

    if (ext === ".py") {
      tools.push(...extractPythonTools(content, relPath));
    } else if (ext === ".ts" || ext === ".js" || ext === ".mjs") {
      tools.push(...extractTypeScriptTools(content, relPath));
    }
  }

  return tools;
}

/**
 * Extract tools from Python source using common MCP patterns:
 * - @server.tool() / @app.tool() decorators
 * - server.tool(name=...) / Tool(...) registrations
 */
function extractPythonTools(content: string, file: string): ExtractedTool[] {
  const tools: ExtractedTool[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Decorator pattern: @server.tool() or @app.tool("name")
    const decoratorMatch = line.match(
      /@\w+\.tool\(\s*(?:name\s*=\s*)?["']([^"']+)["']/
    );
    if (decoratorMatch) {
      const description = extractPythonDocstring(lines, i + 1);
      tools.push(
        buildTool(decoratorMatch[1], description, file, i + 1)
      );
      continue;
    }

    // Bare decorator: @server.tool() with function name
    const bareDecoratorMatch = line.match(/@\w+\.tool\(\s*\)/);
    if (bareDecoratorMatch) {
      const funcMatch = lines[i + 1]?.match(
        /(?:async\s+)?def\s+(\w+)/
      );
      if (funcMatch) {
        const description = extractPythonDocstring(lines, i + 2);
        tools.push(
          buildTool(funcMatch[1], description, file, i + 1)
        );
      }
      continue;
    }

    // Registration pattern: server.tool("name", ...) or Tool(name="...")
    const regMatch = line.match(
      /\.tool\(\s*["']([^"']+)["']/
    );
    if (regMatch && !line.match(/@/)) {
      const description = extractInlineDescription(lines, i);
      tools.push(buildTool(regMatch[1], description, file, i + 1));
      continue;
    }

    // name= keyword pattern: Tool(name="...")
    const nameKwMatch = line.match(
      /Tool\(\s*name\s*=\s*["']([^"']+)["']/
    );
    if (nameKwMatch) {
      const description = extractInlineDescription(lines, i);
      tools.push(
        buildTool(nameKwMatch[1], description, file, i + 1)
      );
    }
  }

  return tools;
}

/**
 * Extract tools from TypeScript/JavaScript source:
 * - server.tool("name", ...) / server.setRequestHandler(...)
 * - Zod schema-based tool definitions
 */
function extractTypeScriptTools(
  content: string,
  file: string
): ExtractedTool[] {
  const tools: ExtractedTool[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // server.tool("name", ...) or app.tool("name", ...)
    const toolMatch = line.match(
      /\.tool\(\s*["']([^"']+)["']\s*,\s*["']([^"']*)["']/
    );
    if (toolMatch) {
      tools.push(
        buildTool(toolMatch[1], toolMatch[2], file, i + 1)
      );
      continue;
    }

    // server.tool("name", schema, handler) — description in next arg
    const toolNoDescMatch = line.match(
      /\.tool\(\s*["']([^"']+)["']\s*,/
    );
    if (toolNoDescMatch && !toolMatch) {
      const description = extractInlineDescription(lines, i);
      tools.push(
        buildTool(toolNoDescMatch[1], description, file, i + 1)
      );
      continue;
    }

    // Object-style: { name: "toolName", description: "..." }
    const objNameMatch = line.match(
      /name\s*:\s*["']([^"']+)["']/
    );
    if (objNameMatch) {
      const descLine = lines.slice(i, i + 5).join(" ");
      const descMatch = descLine.match(
        /description\s*:\s*["']([^"']+)["']/
      );
      if (descMatch) {
        tools.push(
          buildTool(objNameMatch[1], descMatch[1], file, i + 1)
        );
      }
    }
  }

  // Deduplicate by name+file
  const seen = new Set<string>();
  return tools.filter((t) => {
    const key = `${t.name}:${t.sourceFile}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildTool(
  name: string,
  description: string,
  file: string,
  line: number
): ExtractedTool {
  const lowerName = name.toLowerCase();
  const lowerDesc = description.toLowerCase();
  const combined = `${lowerName} ${lowerDesc}`;

  const sensitiveKeywords = WRITE_KEYWORDS.filter(
    (kw) => combined.includes(kw)
  );
  const readSignals = READ_KEYWORDS.filter(
    (kw) => combined.includes(kw)
  );

  let classification: ExtractedTool["classification"] = "unknown";
  if (sensitiveKeywords.length > 0 && readSignals.length === 0) {
    classification = "write";
  } else if (readSignals.length > 0 && sensitiveKeywords.length === 0) {
    classification = "read";
  } else if (sensitiveKeywords.length > readSignals.length) {
    classification = "write";
  } else if (readSignals.length > 0) {
    classification = "read";
  }

  return {
    name,
    description,
    classification,
    sensitiveKeywords,
    sourceFile: file,
    sourceLine: line,
  };
}

function extractPythonDocstring(
  lines: string[],
  startLine: number
): string {
  // Look for triple-quoted docstring in the next few lines
  for (let i = startLine; i < Math.min(startLine + 5, lines.length); i++) {
    const tripleMatch = lines[i].match(/"""(.+?)"""/);
    if (tripleMatch) return tripleMatch[1].trim();

    if (lines[i].includes('"""')) {
      // Multi-line docstring — grab first line
      const firstLine = lines[i].replace(/.*"""/, "").trim();
      if (firstLine) return firstLine;
      if (i + 1 < lines.length) return lines[i + 1].trim();
    }
  }
  return "";
}

function extractInlineDescription(
  lines: string[],
  lineIndex: number
): string {
  // Look for description in surrounding lines
  const window = lines.slice(lineIndex, Math.min(lineIndex + 5, lines.length));
  const joined = window.join(" ");
  const descMatch = joined.match(
    /description\s*[=:]\s*["']([^"']+)["']/
  );
  return descMatch?.[1] ?? "";
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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import type { ExtractedTool } from "./types.js";

const WRITE_KEYWORDS = [
  // CRUD / API
  "create", "insert", "update", "delete", "drop", "alter", "execute",
  "send", "write", "modify", "remove", "destroy", "post", "put", "patch",
  "publish", "deploy", "push", "upload", "mutate", "truncate",
  // Infrastructure / server management
  "restart", "reboot", "harden", "lock", "fix", "restore", "configure",
  "set", "schedule", "install", "apply", "provision", "enable", "disable",
  "start", "stop", "add", "import", "migrate", "prune", "purge",
];

const READ_KEYWORDS = [
  // CRUD / API
  "get", "list", "read", "fetch", "query", "search", "find", "select",
  "describe", "show", "view", "check", "inspect", "count", "status",
  // Infrastructure / observability
  "audit", "scan", "diagnose", "score", "monitor", "overview", "export",
  "watch", "health", "verify", "analyze", "collect", "log",
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
 * - @server.tool() / @app.tool() / @mcp.tool() decorators (single and multi-line)
 * - server.tool(name=...) / Tool(...) registrations
 * - mcp.add_tool(func, ...) dynamic registration (FastMCP)
 */
function extractPythonTools(content: string, file: string): ExtractedTool[] {
  const tools: ExtractedTool[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Decorator pattern: @server.tool("name") or @mcp.tool(name="name")
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

    // Bare decorator: @server.tool() with function name on next line
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

    // Multi-line decorator: @mcp.tool(\n  description="...",\n  ...\n)
    const multiLineDecoratorMatch = line.match(/@(\w+)\.tool\(\s*$/);
    if (multiLineDecoratorMatch) {
      const { closingLine, body } = scanToClosingParen(lines, i);
      if (closingLine >= 0) {
        const nameFromDecorator = extractKwarg(body, "name");
        const descFromDecorator = extractKwarg(body, "description");
        // Find the def line after the closing paren
        let defLine = -1;
        let funcName: string | undefined;
        for (let j = closingLine + 1; j < Math.min(closingLine + 3, lines.length); j++) {
          const defMatch = lines[j]?.match(/(?:async\s+)?def\s+(\w+)/);
          if (defMatch) {
            funcName = defMatch[1];
            defLine = j;
            break;
          }
        }
        if (funcName) {
          const name = nameFromDecorator ?? funcName;
          const description = descFromDecorator
            ?? extractPythonDocstring(lines, defLine + 1);
          tools.push(buildTool(name, description, file, i + 1));
          i = defLine; // skip past the def line
        }
      }
      continue;
    }

    // Dynamic registration: mcp.add_tool(func_ref, description="...")
    const addToolMatch = line.match(/(\w+)\.add_tool\(\s*$/);
    if (addToolMatch) {
      const { closingLine, body } = scanToClosingParen(lines, i);
      if (closingLine >= 0) {
        const funcRef = body.match(/^\s*(\w+)\s*,/)?.[1];
        const descFromCall = extractKwarg(body, "description");
        if (funcRef) {
          tools.push(
            buildTool(funcRef, descFromCall ?? "", file, i + 1)
          );
          i = closingLine;
        }
      }
      continue;
    }
    // Single-line add_tool: mcp.add_tool(func_ref, description="...")
    // Only match when description= is present (distinguishes from dynamic
    // loop registration like `app.add_tool(name, fn)`)
    const addToolInlineMatch = line.match(
      /\w+\.add_tool\(\s*(\w+)\s*,/
    );
    if (addToolInlineMatch && !line.match(/@/)) {
      const window = lines.slice(i, Math.min(i + 5, lines.length)).join(" ");
      if (window.match(/description\s*=/)) {
        const description = extractInlineDescription(lines, i);
        tools.push(
          buildTool(addToolInlineMatch[1], description, file, i + 1)
        );
        continue;
      }
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
 * From a line containing an opening paren, scan forward to find the matching
 * closing paren. Returns the line index of the closing paren and the
 * concatenated body between them. Handles nested parens (e.g. ToolAnnotations()).
 */
function scanToClosingParen(
  lines: string[],
  startLine: number,
  maxScan = 30
): { closingLine: number; body: string } {
  let depth = 0;
  const bodyLines: string[] = [];
  for (let j = startLine; j < Math.min(startLine + maxScan, lines.length); j++) {
    const line = lines[j];
    for (const ch of line) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
    }
    if (j > startLine) bodyLines.push(line);
    if (depth === 0) {
      return { closingLine: j, body: bodyLines.join(" ") };
    }
  }
  return { closingLine: -1, body: "" };
}

/**
 * Extract a keyword argument value from a Python call body.
 * Matches `key="value"` or `key='value'`.
 */
function extractKwarg(body: string, key: string): string | undefined {
  const match = body.match(
    new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`)
  );
  return match?.[1];
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

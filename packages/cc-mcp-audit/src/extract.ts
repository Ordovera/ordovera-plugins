import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
    } else if (ext === ".go") {
      tools.push(...extractGoTools(content, relPath));
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

    // Class-based pattern: class FooBarTool(Tool, ...):
    // Tool name derived from class name: strip "Tool" suffix, convert to snake_case
    const classMatch = line.match(
      /^class\s+([A-Za-z][A-Za-z0-9]*)\s*\([^)]*\bTool\b[^)]*\)\s*:/
    );
    if (classMatch) {
      const className = classMatch[1];
      const toolName = classNameToToolName(className);
      // Find the apply() method docstring for description
      const description = extractClassApplyDocstring(lines, i);
      tools.push(buildTool(toolName, description, file, i + 1));
    }
  }

  return tools;
}

/**
 * Convert a CamelCase class name to a snake_case tool name.
 * Strips "Tool" suffix if present, then converts to snake_case.
 */
function classNameToToolName(className: string): string {
  let name = className;
  if (name.endsWith("Tool")) {
    name = name.slice(0, -4);
  }
  // Insert underscore before each uppercase letter, lowercase everything
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/**
 * Find the docstring from a class's apply() method.
 * Searches forward from the class definition for `def apply(` and extracts
 * the triple-quoted docstring.
 */
function extractClassApplyDocstring(
  lines: string[],
  classLine: number
): string {
  // Search forward for the apply method (within 100 lines)
  for (let j = classLine + 1; j < Math.min(classLine + 100, lines.length); j++) {
    // Stop at the next class definition
    if (/^class\s/.test(lines[j])) break;

    if (/def\s+apply\s*\(/.test(lines[j])) {
      return extractPythonDocstring(lines, j + 1);
    }
  }
  return "";
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

    // server.tool("name", "description", ...) or app.tool("name", "description", ...)
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

    // server.registerTool("name", { ... }) — MCP SDK registerTool pattern
    // Name may be on the same line or the next line
    const registerToolMatch = line.match(
      /\.registerTool\(\s*["']([^"']+)["']/
    );
    if (registerToolMatch) {
      const description = extractInlineDescription(lines, i);
      tools.push(
        buildTool(registerToolMatch[1], description, file, i + 1)
      );
      continue;
    }
    // Multi-line: .registerTool(\n  "name", ...
    if (/\.registerTool\(\s*$/.test(line)) {
      const nextLine = lines[i + 1];
      const nextMatch = nextLine?.match(/^\s*["']([^"']+)["']/);
      if (nextMatch) {
        const description = extractInlineDescription(lines, i + 1);
        tools.push(
          buildTool(nextMatch[1], description, file, i + 1)
        );
        continue;
      }
    }

    // Object-style: { name: "toolName", description: "..." }
    // Only match in non-test source files, near a tool registration context,
    // and not inside server/app constructors.
    if (!isTestFile(file.split("/").pop() ?? "")) {
      const objNameMatch = line.match(
        /name\s*:\s*["']([^"']+)["']/
      );
      if (objNameMatch) {
        const descLine = lines.slice(i, i + 5).join(" ");
        const descMatch = descLine.match(
          /description\s*:\s*["']([^"']+)["']/
        );
        if (descMatch) {
          // Exclude server/app constructor metadata
          const precedingLines = lines.slice(Math.max(0, i - 5), i + 1).join(" ");
          if (!isServerConstructor(precedingLines)) {
            // Check for tool registration context in surrounding lines
            const contextWindow = lines.slice(
              Math.max(0, i - 10),
              Math.min(lines.length, i + 10)
            ).join(" ");
            if (isToolRegistrationContext(contextWindow)) {
              tools.push(
                buildTool(objNameMatch[1], descMatch[1], file, i + 1)
              );
            }
          }
        }
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

/**
 * Check if a code window suggests tool registration context.
 * Reduces false positives from server metadata, CLI descriptors, UI definitions, etc.
 */
/**
 * Extract tools from Go source files.
 *
 * Patterns:
 * - mcp.Tool{ Name: "tool_name", Description: "..." } struct literals
 * - server.AddTool() / s.AddTool() calls with inline Name
 */
function extractGoTools(content: string, file: string): ExtractedTool[] {
  const tools: ExtractedTool[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pattern 1: Name: "tool_name" inside an mcp.Tool struct literal
    // Look for Name field in Go struct context
    const nameFieldMatch = line.match(
      /Name\s*:\s*["'`]([^"'`]+)["'`]/
    );
    if (nameFieldMatch) {
      // Verify this is inside an mcp.Tool or tool-related context
      const contextWindow = lines.slice(
        Math.max(0, i - 10),
        Math.min(lines.length, i + 5)
      ).join(" ");

      if (isGoToolContext(contextWindow)) {
        // Find Description field nearby
        const descWindow = lines.slice(i, Math.min(i + 10, lines.length)).join(" ");
        const descMatch = descWindow.match(
          /Description\s*:\s*(?:t\([^)]*\)\s*,\s*)?["'`]([^"'`]+)["'`]/
        );
        // Also check preceding lines for Description
        const descBefore = lines.slice(Math.max(0, i - 5), i + 1).join(" ");
        const descBeforeMatch = descBefore.match(
          /Description\s*:\s*(?:t\([^)]*\)\s*,\s*)?["'`]([^"'`]+)["'`]/
        );
        const description = descMatch?.[1] ?? descBeforeMatch?.[1] ?? "";
        tools.push(buildTool(nameFieldMatch[1], description, file, i + 1));
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

/**
 * Check if Go code context suggests a tool definition (not a generic struct).
 */
function isGoToolContext(window: string): boolean {
  if (/mcp\.Tool\s*\{/.test(window)) return true;
  if (/\.AddTool\s*\(/.test(window)) return true;
  if (/NewTool\s*\(/.test(window)) return true;
  if (/ToolDefinition/.test(window)) return true;
  if (/ServerTool/.test(window)) return true;
  if (/toolHandler/.test(window)) return true;
  return false;
}

/**
 * Check if the name: field is inside a server/app constructor (not a tool definition).
 * E.g., new McpServer({ name: "MyServer", description: "..." })
 */
function isServerConstructor(precedingLines: string): boolean {
  return /new\s+\w*(?:Server|FastMCP)\s*\(/.test(precedingLines)
    || /(?:Server|FastMCP)\s*\(\s*\{/.test(precedingLines)
    || /createServer\s*\(\s*\{/.test(precedingLines);
}

function isToolRegistrationContext(window: string): boolean {
  // Direct tool registration calls
  if (/\.tool\s*\(/.test(window)) return true;
  if (/registerTool\s*\(/.test(window)) return true;
  if (/addTool\s*\(/.test(window)) return true;
  // Tool array/list context
  if (/tools\s*[:=]\s*\[/.test(window)) return true;
  if (/toolDefinitions/i.test(window)) return true;
  // setRequestHandler for tool listing
  if (/setRequestHandler/.test(window)) return true;
  if (/ListToolsRequest/.test(window)) return true;
  // Schema-based definitions
  if (/inputSchema/i.test(window)) return true;
  return false;
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

/**
 * Detect whether a repo is a thin wrapper around an upstream dependency.
 * Returns the upstream package name if detected, null otherwise.
 *
 * Detection signals:
 * - Entry point is small (<50 lines) and imports from a dependency
 * - package.json dependencies include the imported package
 * - Import path contains tool/mcp/server keywords suggesting MCP capability
 */
/**
 * Known MCP framework packages -- these ARE the framework, not an upstream
 * tool provider. Exclude them from wrapper detection results.
 */
const MCP_FRAMEWORK_PACKAGES = new Set([
  "@modelcontextprotocol/sdk",
  "mcp",
  "fastmcp",
  "@anthropic-ai/sdk",
]);

/**
 * Known MCP Python framework packages.
 */
const MCP_FRAMEWORK_PYTHON_PACKAGES = new Set([
  "mcp",
  "fastmcp",
]);

export function detectUpstreamPackage(repoPath: string): string | null {
  // Collect dependencies from all package.json files (handles monorepos)
  const deps: Record<string, string> = {};
  const pkgFiles = findPackageJsonFiles(repoPath);
  for (const pkgFile of pkgFiles) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf-8"));
      Object.assign(deps, pkg.dependencies, pkg.devDependencies);
    } catch {
      // Invalid JSON
    }
  }

  // Check Python requirements for dependencies
  const pythonDeps = new Set<string>();
  for (const reqFile of ["requirements.txt", "setup.py", "pyproject.toml"]) {
    const reqPath = join(repoPath, reqFile);
    try {
      const content = readFileSync(reqPath, "utf-8");
      // Extract package names from requirements.txt lines or dependency arrays
      for (const match of content.matchAll(/^\s*([a-zA-Z0-9_-]+)/gm)) {
        pythonDeps.add(match[1].toLowerCase());
      }
    } catch {
      // File doesn't exist
    }
  }

  const sourceFiles = findSourceFiles(repoPath);

  // Look for small entry points that re-export from a dependency.
  // Skip test files and declaration files -- focus on actual source.
  const candidates = sourceFiles.filter((f) => {
    const base = f.split("/").pop() ?? "";
    if (isTestFile(base)) return false;
    if (base.endsWith(".d.ts")) return false;
    return true;
  });

  for (const filePath of candidates) {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(l => l.trim().length > 0);

    // Only consider small files as wrapper candidates
    if (lines.length > 50) continue;

    const ext = extname(filePath);

    if (ext === ".py") {
      // Python: from <pkg> import ... or import <pkg>
      const pyImports = content.matchAll(
        /(?:from\s+([a-zA-Z0-9_]+)(?:\.[a-zA-Z0-9_.]*)?(?:\s+import|\s*$))|(?:import\s+([a-zA-Z0-9_]+))/g
      );
      for (const m of pyImports) {
        const pkg = (m[1] ?? m[2]).toLowerCase();
        if (MCP_FRAMEWORK_PYTHON_PACKAGES.has(pkg)) continue;
        // Python treats - and _ as interchangeable in package names
        const normalized = pkg.replace(/_/g, "-");
        if ((pythonDeps.has(pkg) || pythonDeps.has(normalized)) && isMcpRelatedImport(content, pkg)) {
          return pkg;
        }
      }
    } else {
      // JS/TS: import ... from "pkg/..." or require("pkg/...")
      const jsImports = content.matchAll(
        /(?:from\s+["']([^"'./][^"']*)["'])|(?:require\(["']([^"'./][^"']*)["']\))/g
      );
      for (const m of jsImports) {
        const fullSpec = m[1] ?? m[2];
        // Extract bare package name (handle scoped packages)
        const pkg = fullSpec.startsWith("@")
          ? fullSpec.split("/").slice(0, 2).join("/")
          : fullSpec.split("/")[0];

        if (MCP_FRAMEWORK_PACKAGES.has(pkg)) continue;
        if (pkg in deps && isMcpRelatedImport(content, fullSpec)) {
          return pkg;
        }
      }
    }
  }

  return null;
}

/**
 * Find the full import specifiers used to import from an upstream package.
 * E.g., for playwright-core, returns ["playwright-core/lib/coreBundle"].
 * Used by runtime extraction to know which sub-paths to try.
 */
export function findUpstreamImportPaths(
  repoPath: string,
  upstreamPackage: string
): string[] {
  const paths = new Set<string>();
  const sourceFiles = findSourceFiles(repoPath);

  for (const filePath of sourceFiles) {
    const base = filePath.split("/").pop() ?? "";
    if (isTestFile(base) || base.endsWith(".d.ts")) continue;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(l => l.trim().length > 0);
    if (lines.length > 50) continue;

    // Match import/require specifiers that start with the upstream package
    const importMatches = content.matchAll(
      /(?:from\s+["']([^"']+)["'])|(?:require\(["']([^"']+)["']\))/g
    );
    for (const m of importMatches) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith(upstreamPackage + "/") && spec !== upstreamPackage) {
        paths.add(spec);
      }
    }
  }

  return [...paths];
}

/**
 * Runtime tool extraction result from the subprocess script.
 */
interface RuntimeToolDef {
  name: string;
  description: string;
  readOnly?: boolean;
}

/** Default timeout for npm install (60 seconds). */
const NPM_INSTALL_TIMEOUT_MS = 60_000;
/** Default timeout for the extraction script (10 seconds). */
const EXTRACT_SCRIPT_TIMEOUT_MS = 10_000;

/**
 * Attempt runtime extraction of tool definitions from a wrapper repo.
 *
 * 1. Runs `npm install --ignore-scripts --production` if node_modules is missing
 * 2. Executes scripts/runtime-extract.cjs in a subprocess
 * 3. Parses JSON output into ExtractedTool[]
 *
 * Returns an empty array on any failure (graceful degradation).
 */
export function extractToolsRuntime(
  repoPath: string,
  upstreamPackage: string
): { tools: ExtractedTool[]; runtimeWarnings: string[] } {
  const warnings: string[] = [];

  // Only works for JS/TS repos with a package.json
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) {
    warnings.push("Runtime extraction skipped: no package.json found.");
    return { tools: [], runtimeWarnings: warnings };
  }

  // Step 1: npm install if needed
  const nodeModulesPath = join(repoPath, "node_modules");
  if (!existsSync(nodeModulesPath)) {
    try {
      execFileSync("npm", ["install", "--ignore-scripts", "--production"], {
        cwd: repoPath,
        timeout: NPM_INSTALL_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Runtime extraction: npm install failed: ${msg}`);
      return { tools: [], runtimeWarnings: warnings };
    }
  }

  // Step 2: Run the extraction script
  const scriptPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "runtime-extract.cjs"
  );

  // Find actual import paths used in wrapper source for targeted sub-path resolution
  const importPaths = findUpstreamImportPaths(repoPath, upstreamPackage);

  let stdout: string;
  try {
    const result = execFileSync(
      process.execPath,
      [scriptPath, upstreamPackage, repoPath, ...importPaths],
      {
        cwd: repoPath,
        timeout: EXTRACT_SCRIPT_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NODE_PATH: nodeModulesPath },
      }
    );
    stdout = result.toString("utf-8").trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Runtime extraction: script execution failed: ${msg}`);
    return { tools: [], runtimeWarnings: warnings };
  }

  // Step 3: Parse output
  const { tools, parseWarnings } = parseRuntimeOutput(stdout, upstreamPackage);
  warnings.push(...parseWarnings);

  if (tools.length > 0) {
    warnings.push(
      `Runtime extraction found ${tools.length} tool(s) from \`${upstreamPackage}\`.`
    );
  }

  return { tools, runtimeWarnings: warnings };
}

/**
 * Parse JSON output from the runtime extraction script into ExtractedTool[].
 * Exported for unit testing.
 */
export function parseRuntimeOutput(
  stdout: string,
  upstreamPackage: string
): { tools: ExtractedTool[]; parseWarnings: string[] } {
  const warnings: string[] = [];

  if (!stdout || stdout === "[]") {
    return { tools: [], parseWarnings: warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    warnings.push("Runtime extraction: could not parse script output as JSON.");
    return { tools: [], parseWarnings: warnings };
  }

  if (!Array.isArray(parsed)) {
    warnings.push("Runtime extraction: script output is not an array.");
    return { tools: [], parseWarnings: warnings };
  }

  const tools: ExtractedTool[] = [];
  for (const item of parsed) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as RuntimeToolDef).name === "string"
    ) {
      const def = item as RuntimeToolDef;
      tools.push(
        buildTool(
          def.name,
          def.description ?? "",
          `[runtime:${upstreamPackage}]`,
          0
        )
      );
    }
  }

  return { tools, parseWarnings: warnings };
}

/**
 * Scan test files for arrays of string literals near assertion keywords.
 * Returns discovered tool name sets grouped by source file.
 *
 * Detection patterns:
 * - JS/TS: string arrays near expect/assert/toContain/toEqual
 * - Python: string arrays near assert/assertEqual/assertIn
 */
export function extractTestToolNames(
  repoPath: string
): Array<{ names: string[]; sourceFile: string }> {
  const results: Array<{ names: string[]; sourceFile: string }> = [];
  const testFiles = findTestFiles(repoPath);

  for (const filePath of testFiles) {
    const content = readFileSync(filePath, "utf-8");
    const relPath = relative(repoPath, filePath);
    const names = extractToolNamesFromTestContent(content);

    if (names.length > 0) {
      results.push({ names, sourceFile: relPath });
    }
  }

  return results;
}

/**
 * Extract tool-like names from test file content.
 * Looks for string literal arrays near assertion patterns, callTool invocations,
 * and multi-line array expressions.
 */
function extractToolNamesFromTestContent(content: string): string[] {
  const names = new Set<string>();
  const lines = content.split("\n");

  const assertionContext = /(?:expect|assert|toContain|toEqual|assertIn|assertEqual|assert_in|assert_equal)/;

  // Pass 1: Find multi-line arrays near assertions.
  // When a line has `[` without `]`, scan forward for the closing bracket.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line or nearby lines contain assertion keywords
    const windowStart = Math.max(0, i - 3);
    const windowEnd = Math.min(lines.length, i + 3);
    const nearbyText = lines.slice(windowStart, windowEnd).join(" ");
    if (!assertionContext.test(nearbyText)) continue;

    // Check for array opening on this line
    if (line.includes("[")) {
      // Try to extract the full array body, handling multi-line spans
      const arrayBody = extractArrayBody(lines, i);
      if (arrayBody) {
        const stringLiterals = arrayBody.matchAll(/["']([a-z][a-z0-9_-]+)["']/gi);
        for (const lit of stringLiterals) {
          const name = lit[1];
          if (/^[a-z][a-z0-9_-]{2,}$/i.test(name) && isToolLikeName(name)) {
            names.add(name);
          }
        }
      }
    }

    // Pattern 2: Individual assertions like toContain("tool_name")
    const singleMatches = line.matchAll(
      /(?:toContain|assertIn|assert_in|includes)\s*\(\s*["']([a-z][a-z0-9_-]+)["']/gi
    );
    for (const m of singleMatches) {
      if (isToolLikeName(m[1])) {
        names.add(m[1]);
      }
    }

    // Pattern 3: callTool({ name: 'tool_name' }) -- common MCP test pattern
    const callToolMatches = line.matchAll(
      /callTool\s*\(\s*\{[^}]*name\s*:\s*["']([a-z][a-z0-9_-]+)["']/gi
    );
    for (const m of callToolMatches) {
      if (isToolLikeName(m[1])) {
        names.add(m[1]);
      }
    }
    // Multi-line callTool: name might be on the next line
    if (/callTool\s*\(\s*\{/.test(line) && !/name\s*:/.test(line)) {
      const nextLines = lines.slice(i, Math.min(i + 5, lines.length)).join(" ");
      const nameMatch = nextLines.match(
        /callTool\s*\(\s*\{[^}]*name\s*:\s*["']([a-z][a-z0-9_-]+)["']/i
      );
      if (nameMatch && isToolLikeName(nameMatch[1])) {
        names.add(nameMatch[1]);
      }
    }
  }

  return [...names];
}

/**
 * Extract the body of an array starting at the given line.
 * Handles multi-line arrays by scanning forward for the closing bracket.
 * Returns null if no complete array is found within 50 lines.
 */
function extractArrayBody(lines: string[], startLine: number): string | null {
  let depth = 0;
  const bodyLines: string[] = [];

  for (let j = startLine; j < Math.min(startLine + 50, lines.length); j++) {
    const line = lines[j];
    bodyLines.push(line);

    for (const ch of line) {
      if (ch === "[") depth++;
      if (ch === "]") depth--;
    }

    if (depth === 0 && bodyLines.length > 0) {
      return bodyLines.join(" ");
    }
  }

  return null;
}

/**
 * Heuristic: does a string look like a tool name rather than a generic test value?
 * Tool names typically contain an action verb (get_, list_, create_, etc.) or
 * use snake_case/kebab-case with a noun.
 */
function isToolLikeName(name: string): boolean {
  // Must contain an underscore or hyphen (compound name) -- single words are too ambiguous
  if (!/[_-]/.test(name)) return false;
  // Verb prefixes followed by separator
  const verbPrefixes = /^(get|list|create|delete|update|read|write|send|search|find|fetch|query|execute|deploy|check|remove|add|set|start|stop|install|browse|click|navigate|scroll|fill|select|type|press|drag|drop|upload|download|export|import|analyze|scan|monitor|audit|run|push|pull|publish|restore|configure|enable|disable|modify|destroy|truncate|insert|drop|alter|schedule|provision|prune|purge|restart|reboot|harden|lock|fix|verify|diagnose|score|describe|show|view|inspect|count|status|watch|health|collect|log|overview)[_-]/i;
  // Noun prefixes (already include separator)
  const nounPrefixes = /^(browser_|file_|db_|api_|user_|data_|system_|server_|test_)/i;
  return verbPrefixes.test(name) || nounPrefixes.test(name);
}

/**
 * Find test files in a repo.
 */
function findTestFiles(dir: string, depth = 0): string[] {
  if (depth > 6) return [];
  const files: string[] = [];
  const skipDirs = new Set([
    "node_modules", ".git", "dist", "build", "__pycache__",
    ".venv", "venv", ".tox", ".mypy_cache",
  ]);

  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".") && entry !== ".") continue;
      if (skipDirs.has(entry)) continue;

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath, { throwIfNoEntry: false });
      if (!stat) continue;

      if (stat.isDirectory()) {
        // Also recurse into __tests__ directories
        files.push(...findTestFiles(fullPath, depth + 1));
      } else if (isTestFile(entry)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory not readable
  }

  return files;
}

function isTestFile(filename: string): boolean {
  // JS/TS test files
  if (/\.(test|spec)\.(ts|js|mjs)$/.test(filename)) return true;
  // Python test files
  if (/^test_.*\.py$/.test(filename) || /.*_test\.py$/.test(filename)) return true;
  return false;
}

/**
 * Heuristic: does the import context suggest MCP/tool capability?
 * Checks if the imported path or surrounding code references tool/mcp/server keywords.
 */
function isMcpRelatedImport(fileContent: string, importSpec: string): boolean {
  const mcpKeywords = /tool|mcp|server|bundle|core/i;
  // Check the import specifier itself
  if (mcpKeywords.test(importSpec)) return true;
  // Check if the file references tool registration patterns
  const registrationPatterns = /registerTool|register_tool|add_tool|\.tool\(|createConnection|listTools|getTools/;
  if (registrationPatterns.test(fileContent)) return true;
  return false;
}

/**
 * Find all package.json files in a repo (root + nested workspaces).
 * Skips node_modules, .git, etc.
 */
function findPackageJsonFiles(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  const files: string[] = [];
  const skipDirs = new Set([
    "node_modules", ".git", "dist", "build", "__pycache__",
    ".venv", "venv",
  ]);

  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".") && entry !== ".") continue;
      if (skipDirs.has(entry)) continue;

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath, { throwIfNoEntry: false });
      if (!stat) continue;

      if (stat.isDirectory()) {
        files.push(...findPackageJsonFiles(fullPath, depth + 1));
      } else if (entry === "package.json") {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory not readable
  }

  return files;
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
      if ([".py", ".ts", ".js", ".mjs", ".go"].includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

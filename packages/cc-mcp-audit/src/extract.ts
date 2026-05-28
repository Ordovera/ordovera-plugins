import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExtractedTool, SensitivityCategory } from "./types.js";

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

// Sensitivity: data-domain signals (primarily confidentiality)
// These must be specific enough that a single match is sufficient.
const SENSITIVE_DATA_KEYWORDS = [
  // PII / personal data
  "patient", "medical", "health_record", "diagnosis", "prescription",
  "ssn", "social_security", "passport", "driver_license",
  "credit_score", "credit_report",
  "salary", "compensation", "payroll", "bank_account",
  // Credentials / secrets
  "credential", "password", "secret", "api_key", "private_key",
  "certificate", "oauth_token", "bearer_token", "access_token",
  "connection_string", "database_url",
  // Legal / regulatory
  "hipaa", "pci", "ferpa", "gdpr",
];

// Sensitivity: action-scope signals (primarily autonomy/integrity)
const SENSITIVE_ACTION_KEYWORDS = [
  // Financial transactions
  "payment", "transfer_funds", "charge", "refund", "invoice",
  "purchase", "billing",
  // Code execution
  "execute_code", "eval", "run_code", "run_shell", "run_command",
  "shell_exec", "subprocess", "spawn_process",
  // Infrastructure lifecycle
  "destroy_instance", "terminate_instance", "drop_database",
  "delete_account", "revoke_access",
];

// Context-dependent keywords: sensitive only when combined with
// qualifying terms (prevents false positives from generic config/admin tools)
const SENSITIVE_CONTEXT_PAIRS: Array<[string, string[]]> = [
  // "config" is sensitive when combined with these qualifiers
  ["config", ["secret", "credential", "password", "key", "token", "database", "connection"]],
  // "admin" is sensitive when combined with access/permission concepts
  ["admin", ["permission", "role", "access", "privilege", "user", "account"]],
  // "environment" is sensitive when combined with secrets
  ["environment", ["variable", "secret", "key", "token"]],
  // "session" is sensitive when combined with identity
  ["session", ["token", "credential", "identity", "auth"]],
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

  // Pattern Cr: registry-mediated Python tools surfaced via __all__ exports
  // in tools/__init__.py files. Only activates when the repo has a
  // @<x>.list_tools() handler (gate against false positives in non-MCP code).
  const existingNames = new Set(tools.map((t) => t.name));
  const crTools = extractPatternCrRegistry(repoPath, sourceFiles);
  for (const t of crTools) {
    if (!existingNames.has(t.name)) {
      tools.push(t);
      existingNames.add(t.name);
    }
  }

  // Pattern G: TS factory-server with `const tools = [{ name: IDENT, ... }, ...]`
  // and a later for-loop calling `server.tool(tool.name, ...)`. The IDENT is
  // resolved cross-file via the file's import map.
  const gTools = extractPatternGArrayLoopImports(repoPath, sourceFiles);
  for (const t of gTools) {
    if (!existingNames.has(t.name)) {
      tools.push(t);
      existingNames.add(t.name);
    }
  }

  // Pattern H: TS manifest-driven loop. A record literal
  // `const NAME: Record<string, X> = { key: ..., ...spread }` iterated via
  // `Object.entries(NAME)` with `.registerTool(VAR, ...)` inside the loop.
  // Spreads are resolved one hop through the import map.
  const hTools = extractPatternHRecordLoop(repoPath, sourceFiles);
  for (const t of hTools) {
    if (!existingNames.has(t.name)) {
      tools.push(t);
      existingNames.add(t.name);
    }
  }

  // Pattern I: xmcp framework — file-per-tool convention. Gate on xmcp dep +
  // xmcp.config.* at repo root; for each TS file in the configured tools dir,
  // extract the literal `name:` from `export const metadata: ToolMetadata = { ... }`.
  const iTools = extractPatternIXmcp(repoPath);
  for (const t of iTools) {
    if (!existingNames.has(t.name)) {
      tools.push(t);
      existingNames.add(t.name);
    }
  }

  return tools;
}

// ── TS cross-file helpers (used by Patterns F, G, H) ───────────────────────

/**
 * Parse `import { a, b as c, type D } from "<path>"` statements.
 * Returns map of locally-bound name → import source string.
 */
function parseTsImports(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of content.matchAll(re)) {
    const namesRaw = m[1];
    const path = m[2];
    for (let n of namesRaw.split(",")) {
      n = n.trim();
      if (!n) continue;
      // `X as Y` -> Y is the local binding
      const asIdx = n.indexOf(" as ");
      if (asIdx !== -1) n = n.slice(asIdx + 4).trim();
      // `type X` -> X
      if (n.startsWith("type ")) n = n.slice(5).trim();
      if (n) out.set(n, path);
    }
  }
  return out;
}

/**
 * Parse top-level `(export )?const IDENT = "literal"` declarations.
 * Used to resolve identifier-named tool registrations to their literal values.
 */
function parseTsConstLiterals(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?=\s*["']([^"']+)["']/g;
  for (const m of content.matchAll(re)) {
    out.set(m[1], m[2]);
  }
  return out;
}

/**
 * Resolve a relative import spec to an absolute file path on disk.
 * Handles the TS convention of writing `./foo.js` to refer to `./foo.ts`.
 * Returns null for non-relative imports (node_modules) or unresolvable paths.
 */
function resolveTsImport(
  importingFile: string,
  importSpec: string
): string | null {
  if (!importSpec.startsWith(".")) return null;
  const base = join(dirname(importingFile), importSpec);
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".mts"),
    base + ".ts",
    base + ".mts",
    join(base, "index.ts"),
    join(base, "index.mts"),
  ];
  for (const c of candidates) {
    try {
      if (statSync(c, { throwIfNoEntry: false })?.isFile()) return c;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Pattern Cr: when a Python repo has a `@<x>.list_tools()` handler that returns
 * a runtime-built tool list, the actual tool names often live in `__all__`
 * exports of `tools/__init__.py` files rather than at the construction site
 * (which references variables like `Tool(name=tool.name, ...)`).
 *
 * Heuristic: scan any __init__.py under a `tools/` directory for __all__
 * literals, then post-filter to skip obvious framework helpers (classes,
 * dispatchers, registry methods).
 */
function extractPatternCrRegistry(
  repoPath: string,
  sourceFiles: string[]
): ExtractedTool[] {
  // Gate: any .py file with @<x>.list_tools()
  const listToolsRe = /^[ \t]*@\w+\.list_tools\(\s*\)\s*$/m;
  let hasHandler = false;
  for (const filePath of sourceFiles) {
    if (!filePath.endsWith(".py")) continue;
    try {
      if (listToolsRe.test(readFileSync(filePath, "utf-8"))) {
        hasHandler = true;
        break;
      }
    } catch { /* ignore unreadable file */ }
  }
  if (!hasHandler) return [];

  const collected: ExtractedTool[] = [];
  const allListRe = /__all__\s*[+]?=\s*\[([\s\S]*?)\]/g;
  const nameLitRe = /["']([a-zA-Z_][a-zA-Z0-9_]*)["']/g;
  const initPathRe = /(?:^|\/)tools\/(?:[^/]+\/)*__init__\.py$/;

  for (const filePath of sourceFiles) {
    const relPath = relative(repoPath, filePath);
    if (!initPathRe.test(relPath)) continue;
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch { continue; }

    for (const allMatch of content.matchAll(allListRe)) {
      const listBody = allMatch[1];
      const baseLine = content.slice(0, allMatch.index ?? 0)
        .split("\n").length;
      for (const nm of listBody.matchAll(nameLitRe)) {
        const name = nm[1];
        if (!isPlausibleToolName(name)) continue;
        // sourceLines omitted: the tool's declaration is in __init__.py
        // (an export, not a registration), so annotation extraction has no
        // useful target.
        collected.push(
          buildTool(name, "", relPath, baseLine)
        );
      }
    }
  }

  return collected;
}

/**
 * Post-filter for Pattern Cr: reject names that are almost certainly framework
 * classes or dispatcher helpers rather than actual MCP tool names.
 *
 * Calibrated against the kazkozdev/mcp-search-server false positives observed
 * during prototyping (BaseTool, FunctionTool, ToolMetadata, ToolCategory,
 * ToolPriority, append_file, delete_file, list_files).
 */
function isPlausibleToolName(name: string): boolean {
  // CamelCase names are almost always classes, not tools
  if (/^[A-Z]/.test(name)) return false;
  // Common helper/framework identifiers
  const helpers = new Set([
    "tool", "tools", "TOOLS", "error", "success", "logger", "config",
    "register", "load", "register_tool", "register_tools",
    "load_tool", "load_tools",
  ]);
  if (helpers.has(name)) return false;
  // Suffix-based helpers / framework wiring
  if (/_(handler|definitions|registry|store|manager|loader|factory|builder|provider|service|dispatcher|metadata)$/i.test(name)) {
    return false;
  }
  // Prefix-based dispatcher helpers that end in tool/tools (avoids false
  // positives on real tools like `register_user` or `load_config`)
  if (/^(get|set|build|create|make|load|register|call|list|dispatch)_.*tools?$/i.test(name)) {
    return false;
  }
  // Generic tool-on-tool wiring: get_tool_X, call_tool_X, etc.
  if (/^(get|set|build|create|make|load|register|call)_tool(s?)(_|$)/i.test(name)) {
    return false;
  }
  return true;
}

/**
 * Pattern G: TS factory-server uses an inline array of tool descriptors with
 * imported identifier names, then iterates and registers in a loop.
 *
 *   const tools = [
 *     { name: searchSecuritiesToolName, description: searchSecuritiesToolDescription, ... },
 *     { name: getMarketDataToolName, description: getMarketDataToolDescription, ... },
 *     ...
 *   ];
 *   for (const tool of tools) {
 *     server.tool(tool.name, tool.description, tool.schema.shape, tool.handler);
 *   }
 *
 * Each name identifier is resolved one hop via the file's `import {…} from "./path"`
 * statements; the source file must contain `export const IDENT = "literal"`.
 */
function extractPatternGArrayLoopImports(
  repoPath: string,
  sourceFiles: string[]
): ExtractedTool[] {
  const loopRe =
    /\bfor\s*\(\s*const\s+\w+\s+of\s+\w+\s*\)\s*\{[^}]*?\.(?:tool|registerTool)\s*\(\s*\w+\.name/s;
  const arrayRe = /\bconst\s+\w+\s*=\s*\[([\s\S]*?)\]/g;
  const nameFieldRe = /\bname\s*:\s*(\w+)\b/g;
  // Pattern G/K1: also match positional-ident registrations
  //   server.tool(toolNameIdent, descIdent, schema, handler)
  // where toolNameIdent and descIdent are imported. The current `.tool(`
  // matcher in extractTypeScriptTools only handles literal-string first args,
  // so these slip through. We collect (nameIdent, descIdent) pairs whose
  // first ident position is filled with an identifier (not a quote).
  const callIdentRe =
    /\.(?:tool|registerTool)\s*\(\s*(\w+)\s*,\s*(\w+)\s*,/g;

  // Helper: resolve an ident to a literal (local then cross-file).
  const resolveIdent = (
    filePath: string,
    ident: string,
    localConsts: Map<string, string>,
    fileImports: Map<string, string>,
  ): string | undefined => {
    let value = localConsts.get(ident);
    if (value) return value;
    const importSpec = fileImports.get(ident);
    if (!importSpec) return undefined;
    const resolved = resolveTsImport(filePath, importSpec);
    if (!resolved) return undefined;
    try {
      const imported = readFileSync(resolved, "utf-8");
      return parseTsConstLiterals(imported).get(ident);
    } catch { return undefined; }
  };

  const collected: ExtractedTool[] = [];
  for (const filePath of sourceFiles) {
    const ext = extname(filePath);
    if (ext !== ".ts" && ext !== ".mts" && ext !== ".js" && ext !== ".mjs") continue;
    let content: string;
    try { content = readFileSync(filePath, "utf-8"); } catch { continue; }
    const relPath = relative(repoPath, filePath);
    const fileImports = parseTsImports(content);
    const localConsts = parseTsConstLiterals(content);

    // G original shape: const tools = [{ name: IDENT, … }, …] + for-loop.
    if (loopRe.test(content)) {
      const seenInFile = new Set<string>();
      for (const arrM of content.matchAll(arrayRe)) {
        const body = arrM[1];
        const lineNo = content.slice(0, arrM.index ?? 0).split("\n").length;
        for (const nm of body.matchAll(nameFieldRe)) {
          const ident = nm[1];
          if (seenInFile.has(ident)) continue;
          seenInFile.add(ident);
          const value = resolveIdent(filePath, ident, localConsts, fileImports);
          if (!value) continue;
          collected.push(buildTool(value, "", relPath, lineNo));
        }
      }
    }

    // K1: positional `.tool(nameIdent, descIdent, …)` where both idents
    // resolve cross-file. Skip when ident is a JS keyword (false-positive
    // guard) or when it shadows a same-file const that isn't a string literal.
    const keywords = new Set([
      "this", "self", "server", "app", "mcp", "name", "tool",
      "async", "await", "true", "false", "null", "undefined",
    ]);
    const seenK1 = new Set<string>();
    for (const m of content.matchAll(callIdentRe)) {
      const nameIdent = m[1];
      const descIdent = m[2];
      if (keywords.has(nameIdent)) continue;
      if (seenK1.has(nameIdent)) continue;
      const value = resolveIdent(filePath, nameIdent, localConsts, fileImports);
      if (!value) continue;
      const descVal = resolveIdent(filePath, descIdent, localConsts, fileImports) ?? "";
      seenK1.add(nameIdent);
      collected.push(buildTool(value, descVal, relPath, lineOfOffsetFromContent(content, m.index ?? 0)));
    }
  }
  return collected;
}

function lineOfOffsetFromContent(content: string, off: number): number {
  return content.slice(0, off).split("\n").length;
}

/**
 * Pattern H: manifest-driven loop. A record literal acts as the tool registry;
 * an Object.entries loop registers each entry.
 *
 *   const schemaMap: Record<string, AnySchema | null> = {
 *     ...schemas,            // ← spread of imported record
 *     upload_file: z.object({ ... }).strict(),
 *   };
 *   for (const [toolName, schema] of Object.entries(schemaMap)) {
 *     ...
 *     server.registerTool(toolName, { ... });
 *   }
 *
 * Top-level keys of the record are the tool names. Spreads are resolved one
 * hop via the import map; the imported file must export
 * `export const NAME = { key: ..., ... }` whose top-level keys are recursively
 * counted (one level only — avoids unbounded fanout).
 */
function extractPatternHRecordLoop(
  repoPath: string,
  sourceFiles: string[]
): ExtractedTool[] {
  const loopRe =
    /for\s*\(\s*const\s+\[\s*(\w+)[\s,][^\]]*\]\s+of\s+Object\.entries\s*\(\s*(\w+)\s*\)\s*\)[\s\S]*?\.(?:tool|registerTool)\s*\(\s*\1\b/;
  const recordReFor = (name: string) =>
    new RegExp(
      `const\\s+${name}\\s*(?::\\s*Record\\s*<\\s*string\\s*,[^>]+>)?\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`,
      "m"
    );
  // Source-side record export (e.g. `export const schemas = { ... }`)
  const exportedRecordReFor = (name: string) =>
    new RegExp(
      `(?:export\\s+)?const\\s+${name}\\s*(?::\\s*[^=]+)?=\\s*\\{([\\s\\S]*?)\\n\\}`,
      "m"
    );

  const collected: ExtractedTool[] = [];
  for (const filePath of sourceFiles) {
    const ext = extname(filePath);
    if (ext !== ".ts" && ext !== ".mts" && ext !== ".js" && ext !== ".mjs") continue;
    let content: string;
    try { content = readFileSync(filePath, "utf-8"); } catch { continue; }
    const loopM = content.match(loopRe);
    if (!loopM) continue;
    const recordName = loopM[2];
    const relPath = relative(repoPath, filePath);
    const fileImports = parseTsImports(content);

    // First try: record declared in the same file
    let recM = content.match(recordReFor(recordName));
    let bodyContent = content;
    let bodyFile = filePath;
    let bodyRel = relPath;

    // K2: record may be imported from another file. Follow the import.
    if (!recM) {
      const importSpec = fileImports.get(recordName);
      if (importSpec) {
        const resolved = resolveTsImport(filePath, importSpec);
        if (resolved) {
          try {
            const imported = readFileSync(resolved, "utf-8");
            const expM = imported.match(exportedRecordReFor(recordName));
            if (expM) {
              recM = expM;
              bodyContent = imported;
              bodyFile = resolved;
              bodyRel = relative(repoPath, resolved);
            }
          } catch { /* ignore */ }
        }
      }
      if (!recM) continue;
    }
    const body = recM[1];
    const lineNo = bodyContent.slice(0, recM.index ?? 0).split("\n").length;

    const { keys, spreads } = extractTopLevelRecordKeys(body);
    for (const k of keys) collected.push(buildTool(k, "", bodyRel, lineNo));

    // One hop of spread resolution (uses the imports of the file the record
    // lives in — could be original file or the imported file)
    if (spreads.length > 0) {
      const bodyImports = parseTsImports(bodyContent);
      for (const sp of spreads) {
        const importSpec = bodyImports.get(sp);
        if (!importSpec) continue;
        const resolved = resolveTsImport(bodyFile, importSpec);
        if (!resolved) continue;
        let imported: string;
        try { imported = readFileSync(resolved, "utf-8"); } catch { continue; }
        const expM = imported.match(exportedRecordReFor(sp));
        if (!expM) continue;
        const { keys: spKeys } = extractTopLevelRecordKeys(expM[1]);
        const importedRel = relative(repoPath, resolved);
        const importedLineNo = imported.slice(0, expM.index ?? 0).split("\n").length;
        for (const k of spKeys) collected.push(buildTool(k, "", importedRel, importedLineNo));
      }
    }
  }
  return collected;
}

/**
 * Walk a record-literal body and pull top-level keys + spread identifiers.
 *
 * A key counts as "top level" when the enclosing brace depth at the START of
 * the key's line is 0. This lets us recognize `upload_file: z.object({ ... })`
 * (depth opens inside the value expression on the same line) while still
 * skipping keys nested inside child objects on subsequent lines.
 */
function extractTopLevelRecordKeys(body: string): { keys: string[]; spreads: string[] } {
  const keys: string[] = [];
  const spreads: string[] = [];
  const keyRe = /^\s*["']?(\w+)["']?\s*:/;
  const spreadRe = /\.\.\.(\w+)\b/g;

  let depth = 0;
  let inStr = false;
  let strCh = "";
  let lineBuf = "";
  let lineStartDepth = 0;
  const flushLine = () => {
    if (lineStartDepth === 0) {
      const km = lineBuf.match(keyRe);
      if (km) keys.push(km[1]);
      for (const sm of lineBuf.matchAll(spreadRe)) spreads.push(sm[1]);
    }
    lineBuf = "";
    lineStartDepth = depth;
  };
  for (const ch of body) {
    if (inStr) {
      if (ch === strCh) inStr = false;
      lineBuf += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = true;
      strCh = ch;
      lineBuf += ch;
      continue;
    }
    if (ch === "\n") { flushLine(); continue; }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    lineBuf += ch;
  }
  if (lineBuf) flushLine();
  return { keys, spreads };
}

/**
 * Pattern I: xmcp framework. xmcp is a TypeScript MCP server framework that
 * uses a file-per-tool convention. Each tool file under the configured tools
 * directory exports a metadata constant declaring the tool's literal name:
 *
 *   export const metadata: ToolMetadata = {
 *     name: "create-app-store-version",
 *     description: "Create a new App Store version (...)",
 *     annotations: { destructiveHint: false, ... },
 *   };
 *
 * Gate: package.json declares an "xmcp" dependency AND repo root contains
 * xmcp.config.{ts,mts,js,mjs}. The tools directory comes from the config's
 * `paths.tools` string (default "src/tools").
 */
function extractPatternIXmcp(repoPath: string): ExtractedTool[] {
  // Gate 1: xmcp dep in package.json
  const pkgPath = join(repoPath, "package.json");
  let pkgJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch { return []; }
  const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
  if (!("xmcp" in deps)) return [];

  // Gate 2: xmcp.config.* at root, plus parse for tools dir
  let configContent: string | null = null;
  for (const ext of ["ts", "mts", "js", "mjs"]) {
    const cfg = join(repoPath, `xmcp.config.${ext}`);
    try {
      if (statSync(cfg, { throwIfNoEntry: false })?.isFile()) {
        configContent = readFileSync(cfg, "utf-8");
        break;
      }
    } catch { /* ignore */ }
  }
  if (configContent === null) return [];

  const pathsToolsMatch = configContent.match(/tools\s*:\s*["']([^"']+)["']/);
  const toolsDirRel = pathsToolsMatch ? pathsToolsMatch[1] : "src/tools";
  const toolsDir = join(repoPath, toolsDirRel);
  if (!statSync(toolsDir, { throwIfNoEntry: false })?.isDirectory()) return [];

  const metadataRe = /export\s+const\s+metadata\s*(?::\s*ToolMetadata\s*)?=\s*\{([\s\S]*?)\n\}/;
  const nameRe = /\bname\s*:\s*["']([^"']+)["']/;
  const descRe = /\bdescription\s*:\s*["']([^"']+)["']/;

  const collected: ExtractedTool[] = [];
  for (const entry of readdirSync(toolsDir)) {
    if (!entry.endsWith(".ts") && !entry.endsWith(".mts")) continue;
    const filePath = join(toolsDir, entry);
    let content: string;
    try { content = readFileSync(filePath, "utf-8"); } catch { continue; }
    const m = content.match(metadataRe);
    if (!m) continue;
    const body = m[1];
    const nm = body.match(nameRe);
    if (!nm) continue;
    const dm = body.match(descRe);
    const lineNo = content.slice(0, m.index ?? 0).split("\n").length;
    const relPath = relative(repoPath, filePath);
    collected.push(buildTool(nm[1], dm ? dm[1] : "", relPath, lineNo));
  }
  return collected;
}

/**
 * Blank out C-style comments (`//` line and block) while preserving newlines
 * and byte offsets, so line/offset-based matchers never extract tool names that
 * appear inside comments or doc examples. String, rune/char, and raw/backtick
 * literals are tracked so a `//` inside e.g. a `"https://..."` literal is not
 * mistaken for a comment; literal contents are left intact because tool names
 * and descriptions live inside string literals. Shared by the Go extractor and
 * the TypeScript/JavaScript Pattern L (Go, TS, and JS share comment syntax).
 */
function stripCStyleComments(content: string): string {
  let out = "";
  let i = 0;
  const n = content.length;
  type S = "code" | "line" | "block" | "str" | "raw" | "char";
  let state: S = "code";
  while (i < n) {
    const c = content[i];
    const c2 = content[i + 1] ?? "";
    if (state === "code") {
      if (c === "/" && c2 === "/") { out += "  "; i += 2; state = "line"; continue; }
      if (c === "/" && c2 === "*") { out += "  "; i += 2; state = "block"; continue; }
      if (c === '"') { out += c; i++; state = "str"; continue; }
      if (c === "`") { out += c; i++; state = "raw"; continue; }
      if (c === "'") { out += c; i++; state = "char"; continue; }
      out += c; i++; continue;
    }
    if (state === "line") {
      if (c === "\n") { out += "\n"; state = "code"; }
      else out += " ";
      i++; continue;
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") { out += "  "; i += 2; state = "code"; continue; }
      out += c === "\n" ? "\n" : " "; i++; continue;
    }
    if (state === "str" || state === "char") {
      if (c === "\\") { out += c + (content[i + 1] ?? ""); i += 2; continue; }
      out += c; i++;
      if (c === '"' && state === "str") state = "code";
      else if (c === "'" && state === "char") state = "code";
      else if (c === "\n") state = "code"; // safety: unterminated literal
      continue;
    }
    // raw string (backtick): no escapes
    out += c; i++;
    if (c === "`") state = "code";
  }
  return out;
}

/**
 * Blank out Python `#` comments and triple-quoted strings (docstrings) while
 * preserving newlines and column offsets. Single-line `'...'`/`"..."` literals
 * are left intact because Python tool names live inside them
 * (`@mcp.tool("name")`, `Tool(name="x")`). Triple-quoted strings are blanked so
 * registration examples embedded in docstrings are not extracted as tools; the
 * docstring text is still available for descriptions, which are read from the
 * raw (un-stripped) lines elsewhere.
 */
function stripPythonDocstringsAndComments(content: string): string {
  let out = "";
  let i = 0;
  const n = content.length;
  type S = "code" | "comment" | "s1" | "d1" | "s3" | "d3";
  let state: S = "code";
  while (i < n) {
    const c = content[i];
    const three = content.slice(i, i + 3);
    if (state === "code") {
      if (c === "#") { out += " "; i++; state = "comment"; continue; }
      if (three === '"""') { out += "   "; i += 3; state = "d3"; continue; }
      if (three === "'''") { out += "   "; i += 3; state = "s3"; continue; }
      if (c === '"') { out += c; i++; state = "d1"; continue; }
      if (c === "'") { out += c; i++; state = "s1"; continue; }
      out += c; i++; continue;
    }
    if (state === "comment") {
      if (c === "\n") { out += "\n"; state = "code"; }
      else out += " ";
      i++; continue;
    }
    if (state === "d1" || state === "s1") {
      const q = state === "d1" ? '"' : "'";
      if (c === "\\") { out += c + (content[i + 1] ?? ""); i += 2; continue; }
      out += c; i++;
      if (c === q) state = "code";
      else if (c === "\n") state = "code"; // safety: unterminated literal
      continue;
    }
    // triple-quoted string: blank contents, preserve newlines, detect close
    const close = state === "d3" ? '"""' : "'''";
    if (c === "\\") {
      const nx = content[i + 1] ?? "";
      out += " " + (nx === "\n" ? "\n" : nx ? " " : "");
      i += 2; continue;
    }
    if (content.slice(i, i + 3) === close) { out += "   "; i += 3; state = "code"; continue; }
    out += c === "\n" ? "\n" : " "; i++; continue;
  }
  return out;
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
  // Trigger matching runs against a copy with comments and docstrings blanked
  // so registration examples in comments/docstrings are never extracted as
  // tools. Descriptions and call bodies are still read from the raw `lines`.
  const codeLines = stripPythonDocstringsAndComments(content).split("\n");

  // Pattern D gate: which bare-name decorators is this file actually importing?
  // (Without this gate, `@tool(...)` in non-MCP code would be falsely flagged.)
  const BARE_DECORATOR_NAMES = ["tool", "register_tool", "mcp_tool", "server_tool"];
  const importedBareDecorators = new Set<string>();
  for (const dec of BARE_DECORATOR_NAMES) {
    // Match both single-line `from X import a, b, dec, c` and multi-line
    // parenthesized `from X import (\n  ...\n  dec,\n  ...\n)`.
    const escaped = dec.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
    const impRe = new RegExp(
      `from\\s+[\\w.]+\\s+import\\s+(?:` +
      `(?:[^()\\n]*\\b${escaped}\\b)` +
      `|` +
      `\\([^)]*\\b${escaped}\\b[^)]*\\)` +
      `)`
    );
    if (impRe.test(content)) importedBareDecorators.add(dec);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = codeLines[i];

    // Decorator pattern: @server.tool("name") or @mcp.tool(name="name")
    // Multi-segment prefix supported: `@self.mcp.tool(...)`, `@app.api.tool(...)`.
    const decoratorMatch = line.match(
      /@\w+(?:\.\w+)*\.tool\(\s*(?:name\s*=\s*)?["']([^"']+)["']/
    );
    if (decoratorMatch) {
      const description = extractPythonDocstring(lines, i + 1);
      tools.push(
        buildTool(decoratorMatch[1], description, file, i + 1, undefined, lines)
      );
      continue;
    }

    // Bare decorator: @server.tool() with function name on next line (or after stacked decorators)
    // Also matches @server.tool (no parens at all — Pattern O1, semantic-model shape).
    // Multi-segment prefix supported.
    const bareDecoratorMatch = line.match(/@\w+(?:\.\w+)*\.tool(?:\(\s*\))?\s*$/);
    if (bareDecoratorMatch) {
      const { funcName, defLine } = findDefAfterDecorators(lines, i + 1);
      if (funcName && defLine >= 0) {
        const description = extractPythonDocstring(lines, defLine + 1);
        tools.push(
          buildTool(funcName, description, file, i + 1, undefined, lines)
        );
      }
      continue;
    }

    // Multi-line decorator: @mcp.tool(\n  description="...",\n  ...\n)
    // Multi-segment prefix supported.
    const multiLineDecoratorMatch = line.match(/@(\w+(?:\.\w+)*)\.tool\(\s*$/);
    if (multiLineDecoratorMatch) {
      const { closingLine, body } = scanToClosingParen(lines, i);
      if (closingLine >= 0) {
        const nameFromDecorator = extractKwarg(body, "name");
        const descFromDecorator = extractKwarg(body, "description");
        // Find the def line after the closing paren (skip stacked decorators)
        const { funcName, defLine } = findDefAfterDecorators(lines, closingLine + 1);
        if (funcName && defLine >= 0) {
          const name = nameFromDecorator ?? funcName;
          const description = descFromDecorator
            ?? extractPythonDocstring(lines, defLine + 1);
          tools.push(buildTool(name, description, file, i + 1, undefined, lines));
          i = defLine; // skip past the def line
        }
      }
      continue;
    }

    // Pattern B: kwargs-only single-line decorator like
    //   @mcp.tool(annotations={"readOnlyHint": True})
    //   @mcp.tool(readonly=True)
    // The previous three patterns reject these: pattern 1 wants a string-name,
    // pattern 2 wants empty parens, pattern 3 wants the `(` at end of line.
    // Fall back to the function name from the `def` that follows.
    // Multi-segment prefix supported.
    const kwargsOnlyToolMatch = line.match(/^\s*@\w+(?:\.\w+)*\.tool\((.*)\)\s*$/);
    if (kwargsOnlyToolMatch) {
      const body = kwargsOnlyToolMatch[1];
      const hasPositionalName = /^\s*["']/.test(body);
      const hasNameKwarg = /\bname\s*=\s*["']/.test(body);
      if (!hasPositionalName && !hasNameKwarg) {
        const { funcName, defLine } = findDefAfterDecorators(lines, i + 1);
        if (funcName && defLine >= 0) {
          const description = extractPythonDocstring(lines, defLine + 1);
          tools.push(
            buildTool(funcName, description, file, i + 1, undefined, lines)
          );
        }
        continue;
      }
    }

    // Pattern D: bare-name tool decorator imported from a project base module
    //   from edgar.ai.mcp.tools.base import tool
    //   @tool(
    //     name="edgar_company",
    //     description="...",
    //   )
    //   def my_func(...): ...
    //
    // Gated by importedBareDecorators (computed above) so we don't catch
    // generic `@tool` decorators in unrelated code.
    const bareDecMatch = line.match(/^\s*@(tool|register_tool|mcp_tool|server_tool)\(/);
    if (bareDecMatch && importedBareDecorators.has(bareDecMatch[1])) {
      const isMultilineOpen = /\(\s*$/.test(line);
      if (isMultilineOpen) {
        const { closingLine, body } = scanToClosingParen(lines, i);
        if (closingLine >= 0) {
          const nameFromDecorator = extractKwarg(body, "name");
          const descFromDecorator = extractKwarg(body, "description");
          const { funcName, defLine } = findDefAfterDecorators(lines, closingLine + 1);
          if (funcName && defLine >= 0) {
            const name = nameFromDecorator ?? funcName;
            const description = descFromDecorator
              ?? extractPythonDocstring(lines, defLine + 1);
            tools.push(buildTool(name, description, file, i + 1, undefined, lines));
            i = defLine;
          }
        }
        continue;
      } else {
        // Single-line: @tool(name="x", description="y") or @tool(readonly=True)
        const nameMatch = line.match(/\bname\s*=\s*["']([^"']+)["']/);
        if (nameMatch) {
          const description = extractInlineDescription(lines, i);
          tools.push(
            buildTool(nameMatch[1], description, file, i + 1, undefined, lines)
          );
        } else {
          const { funcName, defLine } = findDefAfterDecorators(lines, i + 1);
          if (funcName && defLine >= 0) {
            const description = extractPythonDocstring(lines, defLine + 1);
            tools.push(
              buildTool(funcName, description, file, i + 1, undefined, lines)
            );
          }
        }
        continue;
      }
    }

    // Pattern P: multi-line tool() call with function-ref + kwargs
    //   self.tool(
    //     find_foo,
    //     name="qdrant-find",
    //     description="...",
    //   )
    // Common in FastMCP subclasses with a setup_tools() method (qdrant shape).
    // Requires `name=` kwarg with a literal value. The first non-kwarg positional
    // is typically a function reference and used as a fallback tool name.
    // Excludes decorator lines (those start with `@`).
    const patternPMatch = line.match(/^\s*\w+\.tool\(\s*$/);
    if (patternPMatch && !line.trim().startsWith("@")) {
      const { closingLine, body } = scanToClosingParen(lines, i);
      if (closingLine >= 0) {
        const nameFromKwarg = extractKwarg(body, "name");
        const descFromKwarg = extractKwarg(body, "description");
        const funcRef = body.match(/^\s*(\w+)\s*,/)?.[1];
        const toolName = nameFromKwarg ?? funcRef;
        if (toolName) {
          tools.push(
            buildTool(toolName, descFromKwarg ?? "", file, i + 1, undefined, lines)
          );
          i = closingLine;
        }
      }
      continue;
    }

    // Pattern O2: single-line `<mcp>.tool(<func_ref>)` registration where the
    // single argument is a function reference. The tool name IS the function
    // name (no `name=` kwarg, no string literal). Common in vnstock-style
    // sub-MCP wiring: `finance_mcp.tool(get_income_statements)`.
    // Reject if the call has any kwargs (those are caught by Pattern P above)
    // or any string literal first arg (handled by other matchers).
    const patternO2Match = line.match(/^\s*\w+\.tool\(\s*(\w+)\s*\)\s*$/);
    if (patternO2Match) {
      const funcRef = patternO2Match[1];
      // Reject identifiers that are obviously not tool names (loop vars, etc.)
      const skip = new Set(["self", "cls", "tool", "name", "func"]);
      if (!skip.has(funcRef)) {
        tools.push(
          buildTool(funcRef, "", file, i + 1, undefined, lines)
        );
        continue;
      }
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
            buildTool(funcRef, descFromCall ?? "", file, i + 1, undefined, lines)
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
          buildTool(addToolInlineMatch[1], description, file, i + 1, undefined, lines)
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
      tools.push(buildTool(regMatch[1], description, file, i + 1, undefined, lines));
      continue;
    }

    // name= keyword pattern: Tool(name="...")
    const nameKwMatch = line.match(
      /Tool\(\s*name\s*=\s*["']([^"']+)["']/
    );
    if (nameKwMatch) {
      const description = extractInlineDescription(lines, i);
      tools.push(
        buildTool(nameKwMatch[1], description, file, i + 1, undefined, lines)
      );
    }

    // Pattern C: multi-line Tool() constructor with name on next non-blank line.
    //   Tool(
    //     name="jis_whoami",
    //     description="...",
    //   )
    // Catches inline tool literals inside @list_tools() handler bodies.
    // \bTool\b ensures we don't match suffix matches like `MyTool(`.
    const multilineToolCtor = line.match(/\bTool\(\s*$/);
    if (multilineToolCtor) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = lines[j];
        if (!next.trim()) continue;
        const nm = next.match(/^\s*name\s*=\s*["']([^"']+)["']/);
        if (nm) {
          const description = extractInlineDescription(lines, j);
          tools.push(
            buildTool(nm[1], description, file, i + 1, undefined, lines)
          );
        }
        break;
      }
      continue;
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
      tools.push(buildTool(toolName, description, file, i + 1, undefined, lines));
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
  maxScan = 200
): { closingLine: number; body: string } {
  // maxScan was 30, but modern MCP decorator calls commonly span 50-100+ lines
  // (long triple-quoted descriptions + nested params dicts). 200 keeps us safe
  // against runaway scans on unbalanced parens while accommodating real code.
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
  // Prefer triple-quoted (Python multi-line) values when present
  const tripleDouble = body.match(
    new RegExp(`${key}\\s*=\\s*"""([\\s\\S]+?)"""`)
  );
  if (tripleDouble) return tripleDouble[1].trim();
  const tripleSingle = body.match(
    new RegExp(`${key}\\s*=\\s*'''([\\s\\S]+?)'''`)
  );
  if (tripleSingle) return tripleSingle[1].trim();
  // Standard single-line quoted
  const single = body.match(
    new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`)
  );
  return single?.[1];
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
  const lineOfOffset = (off: number) => content.slice(0, off).split("\n").length;

  // Patterns E and F: whole-file scans for custom wrapper calls. The wrappers
  // are typically written across multiple lines (the helper signature has 5-7
  // arguments), so per-line matching misses everything; scan the whole content.
  const fileImports = parseTsImports(content);
  const fileConsts = parseTsConstLiterals(content);
  // Pattern E/F gate on `registerTool` import: when it's imported from a LOCAL
  // path, the call is a user wrapper around server.registerTool. Otherwise the
  // SDK's `.registerTool("name", ...)` method-call matcher below handles it.
  const registerToolImport = fileImports.get("registerTool");
  const hasLocalRegisterTool =
    registerToolImport !== undefined && registerToolImport.startsWith(".");

  // Pattern E: custom wrapper(server, "name", "description", schema, handler, ...).
  // Built-in wrapper names: defineTool, createTool. Plus registerTool when
  // gated as a local wrapper. Optional `<TypeParam>` generic between the
  // function name and `(` is allowed (bthurlow uses `registerTool<TParams>(...)`).
  //
  // Pattern Q generalization: the literal name may be the 2nd OR 3rd positional
  // arg. Some local wrappers thread an extra context/registry arg before the
  // name, e.g. lcm2m's `registerTool(server, registry, "name", {config}, handler)`.
  // `(?:\w+\s*,\s*)?` optionally consumes that extra identifier arg. It cannot
  // consume the name itself (a quoted literal is not `\w`), so the 2nd-arg shape
  // still matches as before.
  const eFnNames = ["defineTool", "createTool"];
  if (hasLocalRegisterTool) eFnNames.push("registerTool");
  const eFnAlt = eFnNames.join("|");
  const patternEWithDescRe = new RegExp(
    `\\b(?:${eFnAlt})\\s*(?:<[^>]+>)?\\s*\\(\\s*\\w+\\s*,\\s*(?:\\w+\\s*,\\s*)?["']([^"']+)["']\\s*,\\s*["']([^"']*)["']`,
    "g"
  );
  const seenPatternE = new Set<string>();
  for (const m of content.matchAll(patternEWithDescRe)) {
    seenPatternE.add(m[1]);
    tools.push(
      buildTool(m[1], m[2], file, lineOfOffset(m.index ?? 0), undefined, lines)
    );
  }
  // No-description fallback: same shape, name only.
  const patternENoDescRe = new RegExp(
    `\\b(?:${eFnAlt})\\s*(?:<[^>]+>)?\\s*\\(\\s*\\w+\\s*,\\s*(?:\\w+\\s*,\\s*)?["']([^"']+)["']`,
    "g"
  );
  for (const m of content.matchAll(patternENoDescRe)) {
    if (seenPatternE.has(m[1])) continue;
    seenPatternE.add(m[1]);
    const line = lineOfOffset(m.index ?? 0);
    tools.push(
      buildTool(m[1], extractInlineDescription(lines, line - 1), file, line, undefined, lines)
    );
  }

  // Pattern F: local-wrapper registerTool(server, NAME_CONST, DESC_CONST, ...)
  // where name/description are identifier references to same-file consts. This
  // remains separate from Pattern E because the ident-resolution path differs
  // (E reads literals directly; F walks the const map). Both are gated on the
  // same local-import check.
  if (hasLocalRegisterTool) {
    const patternFRe = /\bregisterTool\s*\(\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)/g;
    for (const m of content.matchAll(patternFRe)) {
      const nameVal = fileConsts.get(m[1]);
      const descVal = fileConsts.get(m[2]);
      if (!nameVal) continue;
      tools.push(
        buildTool(nameVal, descVal ?? "", file, lineOfOffset(m.index ?? 0), undefined, lines)
      );
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // server.tool("name", "description", ...) or app.tool("name", "description", ...)
    const toolMatch = line.match(
      /\.tool\(\s*["']([^"']+)["']\s*,\s*["']([^"']*)["']/
    );
    if (toolMatch) {
      tools.push(
        buildTool(toolMatch[1], toolMatch[2], file, i + 1, undefined, lines)
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
        buildTool(toolNoDescMatch[1], description, file, i + 1, undefined, lines)
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
        buildTool(registerToolMatch[1], description, file, i + 1, undefined, lines)
      );
      continue;
    }
    // Multi-line: .tool( or .registerTool( with name on next non-blank line.
    //   server.tool(
    //     "tool_name",
    //     "description",
    //     ...
    //
    // Modern MCP servers use this form because schemas and descriptions are
    // too long to fit on one line.
    //
    // Stops looking forward at the first non-blank line that isn't a quoted
    // literal -- this avoids false positives when the name is a variable
    // reference like server.tool(toolName, ...) (a documented limitation;
    // resolving variable names requires cross-file analysis).
    if (/\.(?:tool|registerTool)\(\s*$/.test(line)) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const next = lines[j];
        if (!next.trim()) continue;
        const nameMatch = next.match(/^\s*["']([^"']+)["']/);
        if (nameMatch) {
          // For `.tool("name", "description", ...)` form, the description is
          // the next non-blank line's quoted literal (positional). For
          // `.registerTool("name", { description: "..." })` form, it's a
          // kwarg-style match inside the options object. Try positional
          // first, fall back to kwarg-style.
          let description = "";
          for (let k = j + 1; k < Math.min(j + 5, lines.length); k++) {
            const descLine = lines[k];
            if (!descLine.trim()) continue;
            const posMatch = descLine.match(/^\s*["']([^"']+)["']/);
            if (posMatch) description = posMatch[1];
            break;
          }
          if (!description) description = extractInlineDescription(lines, j);
          tools.push(
            buildTool(nameMatch[1], description, file, i + 1, undefined, lines)
          );
        }
        break;
      }
      continue;
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
                buildTool(objNameMatch[1], descMatch[1], file, i + 1, undefined, lines)
              );
            }
          }
        }
      }
    }
  }

  // Pattern L: low-level `server.setRequestHandler(ListToolsRequestSchema, ...)`
  // handlers that return a `tools: [{ name, description, inputSchema }, ...]`
  // array. Depth-aware extraction so nested `name:` props inside inputSchema are
  // never mistaken for tool names (a naive scan over-counts 5-30x).
  tools.push(...extractListToolsArrayTools(content, file, lines, lineOfOffset));

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
 * Pattern L: extract tool names from a low-level MCP SDK ListTools handler's
 * tools array. Gated on the file containing a `setRequestHandler(...ListTools...)`
 * registration. Locates the tools array (inline `tools: [...]`, `tools: IDENT`,
 * or `return { tools }` shorthand resolved to a same-file `const`), then walks
 * it tracking string state and bracket/brace depth. A `name: "literal"` is a
 * tool name only at element-object depth (depth 2: one `[` + one `{`); nested
 * objects (inputSchema, annotations) sit deeper and are ignored. At most one
 * name is taken per array element.
 */
function extractListToolsArrayTools(
  content: string,
  file: string,
  lines: string[],
  lineOfOffset: (off: number) => number
): ExtractedTool[] {
  const out: ExtractedTool[] = [];
  // Strip comments first (offset-preserving) so a `tools: [...]` example in a
  // comment can neither trip the gate nor misdirect the array finder.
  const code = stripCStyleComments(content);
  if (!/setRequestHandler\s*\(\s*[\w.]*ListTools/.test(code)) return out;

  // arrOpen is a byte offset; stripCStyleComments preserves length, so it is
  // valid in the raw `content` too. Walk the RAW content via skipNonCode, which
  // robustly steps over comments, strings, and template literals (escapes +
  // `${}` interpolation) so structural depth tracking only sees real code.
  const arrOpen = findToolsArrayOpen(code);
  if (arrOpen < 0) return out;

  const nameKeyRe = /^name\s*:\s*["'`]([^"'`]+)["'`]/;
  let depth = 0;
  let capturedInElement = false;
  const n = content.length;
  let i = arrOpen;
  while (i < n) {
    const skip = skipNonCode(content, i);
    if (skip > i) { i = skip; continue; }
    const c = content[i];
    if (c === "[" || c === "{") {
      depth++;
      if (depth === 2 && c === "{") capturedInElement = false;
      i++;
      continue;
    }
    if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) break; // tools array closed
      i++;
      continue;
    }
    if (depth === 2 && !capturedInElement && c === "n") {
      const m = content.slice(i).match(nameKeyRe);
      if (m) {
        out.push(buildTool(m[1], "", file, lineOfOffset(i), undefined, lines));
        capturedInElement = true;
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return out;
}

/**
 * Given an index into JS/TS source, if it begins a non-code token (line or
 * block comment, single/double-quoted string, or template literal), return the
 * index just past that token; otherwise return `i` unchanged. Template literals
 * are walked with escape handling and balanced `${...}` interpolation skipping
 * (interpolations may themselves contain nested strings/templates).
 */
function skipNonCode(s: string, i: number): number {
  const c = s[i];
  const c1 = s[i + 1];
  if (c === "/" && c1 === "/") {
    const nl = s.indexOf("\n", i);
    return nl < 0 ? s.length : nl;
  }
  if (c === "/" && c1 === "*") {
    const e = s.indexOf("*/", i + 2);
    return e < 0 ? s.length : e + 2;
  }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === "\\") { j += 2; continue; }
      if (s[j] === c) return j + 1;
      if (s[j] === "\n") return j; // unterminated-string safety
      j++;
    }
    return j;
  }
  if (c === "`") {
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === "\\") { j += 2; continue; }
      if (s[j] === "`") return j + 1;
      if (s[j] === "$" && s[j + 1] === "{") {
        let d = 1;
        j += 2;
        while (j < s.length && d > 0) {
          const sk = skipNonCode(s, j);
          if (sk > j) { j = sk; continue; }
          const k = s[j];
          if (k === "{") d++;
          else if (k === "}") d--;
          j++;
        }
        continue;
      }
      j++;
    }
    return j;
  }
  return i;
}

/**
 * Find the byte offset of the `[` that opens a ListTools `tools` array.
 * Handles inline `tools: [`, `tools: IDENT` (resolved to a same-file
 * `const IDENT = [`), and `return { tools }` shorthand (const named `tools`).
 * Returns -1 if not found.
 */
function findToolsArrayOpen(content: string): number {
  const inline = content.match(/\btools\s*:\s*\[/);
  if (inline && inline.index !== undefined) {
    return inline.index + inline[0].length - 1;
  }
  // Collect candidate array-const identifiers from `tools: IDENT`,
  // `tools: typeof IDENT` (type annotations still name the array), and the
  // `return { tools }` shorthand. Skip primitive/type-keyword captures.
  const skip = new Set([
    "string", "number", "boolean", "any", "unknown", "object", "Tool", "Array",
    "ReadonlyArray", "void", "null", "undefined",
  ]);
  const idents: string[] = [];
  for (const m of content.matchAll(/\btools\s*:\s*(?:typeof\s+)?([A-Za-z_]\w*)/g)) {
    if (!skip.has(m[1]) && !idents.includes(m[1])) idents.push(m[1]);
  }
  if (/\{\s*tools\s*\}/.test(content) && !idents.includes("tools")) idents.push("tools");
  for (const ident of idents) {
    const escaped = ident.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
    const constRe = new RegExp(
      `(?:export\\s+)?const\\s+${escaped}\\s*(?::[^=]+)?=\\s*\\[`
    );
    const cm = content.match(constRe);
    if (cm && cm.index !== undefined) {
      return cm.index + cm[0].length - 1;
    }
  }
  return -1;
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
  // Match against a comment-stripped copy so tool registrations that appear in
  // comments or doc examples are not extracted. String literals are preserved
  // (Go tool names/descriptions live in them).
  const cleaned = stripCStyleComments(content);
  const lines = cleaned.split("\n");

  // Pattern J2: custom Go MCP layer where each tool is a struct implementing an
  // interface with a `Name() string` method returning a literal. Gate on the
  // file also containing an `InputSchema(` method (the MCP tool-interface
  // signal) to avoid matching arbitrary Go types that happen to have Name().
  const hasInputSchemaMethod = /\bInputSchema\s*\(/.test(cleaned);
  if (hasInputSchemaMethod) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^func\s*\(\s*\w+\s+\w+\s*\)\s*Name\(\)\s*string\s*\{/);
      if (!m) continue;
      // Tool name is the literal returned within the next few lines.
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const rm = lines[j].match(/return\s+["'`]([^"'`]+)["'`]/);
        if (rm) {
          tools.push(buildTool(rm[1], "", file, i + 1, undefined, lines));
          break;
        }
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pattern J1: mark3labs/mcp-go `mcp.NewTool("name", mcp.WithDescription("..."))`.
    // The tool name is the first positional string arg. Description, when
    // present, is a `WithDescription("...")` option that may be on the same line
    // or a following line within the call. Matches any package alias
    // (mcp.NewTool, mcplib.NewTool, etc.).
    const newToolMatch = line.match(
      /\b\w+\.NewTool\(\s*["'`]([^"'`]+)["'`]/
    );
    if (newToolMatch) {
      // Look for WithDescription within the next ~15 lines (call body)
      const descWindow = lines.slice(i, Math.min(i + 15, lines.length)).join(" ");
      const descMatch = descWindow.match(
        /WithDescription\(\s*["'`]([^"'`]+)["'`]/
      );
      tools.push(
        buildTool(newToolMatch[1], descMatch?.[1] ?? "", file, i + 1, undefined, lines)
      );
      continue;
    }

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
        tools.push(buildTool(nameFieldMatch[1], description, file, i + 1, undefined, lines));
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
  line: number,
  annotations?: ExtractedTool["annotations"],
  sourceLines?: string[]
): ExtractedTool {
  // Auto-extract annotations from source if not provided explicitly
  if (!annotations && sourceLines) {
    annotations = extractAnnotations(sourceLines, line - 1); // line is 1-based, array is 0-based
  }
  const lowerName = name.toLowerCase();
  const lowerDesc = description.toLowerCase();
  const combined = `${lowerName} ${lowerDesc}`;

  const writeSignals = WRITE_KEYWORDS.filter(
    (kw) => combined.includes(kw)
  );
  const readSignals = READ_KEYWORDS.filter(
    (kw) => combined.includes(kw)
  );

  // --- Read/write classification (persistent-effect axis) ---
  let classification: ExtractedTool["classification"] = "unknown";

  if (annotations?.readOnlyHint === true) {
    classification = "read";
  } else if (annotations?.readOnlyHint === false || annotations?.destructiveHint === true) {
    classification = "write";
  } else if (writeSignals.length > 0 && readSignals.length === 0) {
    classification = "write";
  } else if (readSignals.length > 0 && writeSignals.length === 0) {
    classification = "read";
  } else if (writeSignals.length > readSignals.length) {
    classification = "write";
  } else if (readSignals.length > 0) {
    classification = "read";
  }

  // --- Sensitivity classification (governance-relevance axis) ---
  const { sensitivity, sensitivityCategory, sensitivitySignals } =
    classifySensitivity(combined, annotations);

  const tool: ExtractedTool = {
    name,
    description,
    classification,
    writeSignals,
    sensitivity,
    sensitivityCategory,
    sensitivitySignals,
    sourceFile: file,
    sourceLine: line,
  };

  if (annotations) {
    tool.annotations = annotations;
  }

  return tool;
}

/**
 * Classify tool sensitivity based on name+description keywords and annotations.
 *
 * A single specific keyword match is sufficient (per design decision).
 * Context-dependent keywords require a qualifying term nearby.
 * openWorldHint can promote to sensitive but never demote.
 */
/**
 * Test whether a keyword appears in text at a word boundary.
 * Word boundaries are: start/end of string, space, underscore, hyphen, dot,
 * colon, slash, or camelCase transition (lowercase->uppercase).
 *
 * This prevents "secret" matching inside "secretary" or "medical" matching
 * inside "nonmedical". Tool names use snake_case, kebab-case, dot.notation,
 * and occasionally camelCase, so all of these are valid boundaries.
 */
function matchesAtBoundary(text: string, keyword: string): boolean {
  let pos = 0;
  while (pos <= text.length - keyword.length) {
    const idx = text.indexOf(keyword, pos);
    if (idx === -1) return false;

    const before = idx === 0 ? "" : text[idx - 1];
    const after = idx + keyword.length >= text.length ? "" : text[idx + keyword.length];

    const boundaryChars = /[\s_\-.:\/]/;
    const leftOk = idx === 0 || boundaryChars.test(before)
      || (before === before.toLowerCase() && keyword[0] === keyword[0].toUpperCase());
    const rightOk = idx + keyword.length >= text.length || boundaryChars.test(after)
      || (keyword[keyword.length - 1] === keyword[keyword.length - 1].toLowerCase()
          && after === after.toUpperCase());

    if (leftOk && rightOk) return true;
    pos = idx + 1;
  }
  return false;
}

function classifySensitivity(
  combined: string,
  annotations?: ExtractedTool["annotations"]
): {
  sensitivity: ExtractedTool["sensitivity"];
  sensitivityCategory: SensitivityCategory | null;
  sensitivitySignals: string[];
} {
  const signals: string[] = [];
  let category: SensitivityCategory | null = null;

  // Check data-domain keywords (confidentiality)
  for (const kw of SENSITIVE_DATA_KEYWORDS) {
    if (matchesAtBoundary(combined, kw)) {
      signals.push(kw);
      if (!category) category = "confidentiality";
    }
  }

  // Check action-scope keywords (autonomy/integrity)
  for (const kw of SENSITIVE_ACTION_KEYWORDS) {
    if (matchesAtBoundary(combined, kw)) {
      signals.push(kw);
      if (!category) {
        // Financial/communication actions -> autonomy; code exec -> integrity
        if (kw.includes("exec") || kw.includes("shell") || kw.includes("spawn") || kw.includes("eval")) {
          category = "integrity";
        } else {
          category = "autonomy";
        }
      }
    }
  }

  // Check context-dependent pairs (both base and qualifier must be present)
  for (const [base, qualifiers] of SENSITIVE_CONTEXT_PAIRS) {
    if (matchesAtBoundary(combined, base)) {
      for (const q of qualifiers) {
        if (matchesAtBoundary(combined, q)) {
          signals.push(`${base}+${q}`);
          if (!category) category = "confidentiality";
          break;
        }
      }
    }
  }

  // openWorldHint can promote to sensitive (one-way: never used to demote)
  if (annotations?.openWorldHint === true && signals.length === 0) {
    // Weak signal alone -- don't classify as sensitive without other evidence
    // But if there are already signals, it reinforces them (no-op since already sensitive)
  }

  if (signals.length > 0) {
    return { sensitivity: "sensitive", sensitivityCategory: category, sensitivitySignals: signals };
  }

  return { sensitivity: "non-sensitive", sensitivityCategory: null, sensitivitySignals: [] };
}

// Export for direct unit testing
export { classifySensitivity as _classifySensitivity, matchesAtBoundary as _matchesAtBoundary };

/**
 * Starting from a given line, skip past any stacked decorators (@...)
 * to find the next `def` or `async def` line.
 * Returns the function name and line index, or null if not found within 5 lines.
 */
function findDefAfterDecorators(
  lines: string[],
  startLine: number
): { funcName: string | undefined; defLine: number } {
  for (let j = startLine; j < Math.min(startLine + 5, lines.length); j++) {
    const defMatch = lines[j]?.match(/(?:async\s+)?def\s+(\w+)/);
    if (defMatch) {
      return { funcName: defMatch[1], defLine: j };
    }
    // Skip lines that are decorators or blank
    if (/^\s*@/.test(lines[j]) || /^\s*$/.test(lines[j])) continue;
    // Hit something that's not a decorator or def -- stop
    break;
  }
  return { funcName: undefined, defLine: -1 };
}

/**
 * Scan lines around a tool definition for MCP annotation hints.
 * Looks for readOnlyHint, destructiveHint, idempotentHint, openWorldHint
 * in both camelCase (TS/JS) and snake_case (Python) within a window
 * of lines before and after the tool definition line.
 */
function extractAnnotations(
  lines: string[],
  toolLine: number,
  windowBefore = 10,
  windowAfter = 5
): ExtractedTool["annotations"] | undefined {
  // Scan forward from the tool line to find annotations in this tool's block.
  // Also scan a few lines backward (within the same tool's decorator/definition),
  // but stop if we hit another tool's definition.
  let start = toolLine;
  for (let j = toolLine - 1; j >= Math.max(0, toolLine - windowBefore); j--) {
    const line = lines[j];
    // Stop at blank line (tool definitions are typically separated by blank lines)
    if (line.trim() === "") break;
    // Stop at another tool registration (not the current one)
    if (j < toolLine - 1 && line.match(/@\w+\.tool\(|\.tool\(\s*["']|\.registerTool\(|mcp\.NewTool|\.AddTool\(|\.add_tool\(/)) {
      break;
    }
    start = j;
  }
  const end = Math.min(lines.length, toolLine + windowAfter);
  const window = lines.slice(start, end).join("\n");

  // Check if any annotation hint appears in the window
  if (
    !window.match(/readOnlyHint|read_only_hint|destructiveHint|destructive_hint|idempotentHint|idempotent_hint|openWorldHint|open_world_hint/i)
  ) {
    return undefined;
  }

  const annotations: ExtractedTool["annotations"] = {};

  const readOnly = window.match(/readOnlyHint\s*[:=]\s*(true|false|True|False)/i)
    ?? window.match(/read_only_hint\s*[:=]\s*(true|false|True|False)/i);
  if (readOnly) annotations.readOnlyHint = readOnly[1].toLowerCase() === "true";

  const destructive = window.match(/destructiveHint\s*[:=]\s*(true|false|True|False)/i)
    ?? window.match(/destructive_hint\s*[:=]\s*(true|false|True|False)/i);
  if (destructive) annotations.destructiveHint = destructive[1].toLowerCase() === "true";

  const idempotent = window.match(/idempotentHint\s*[:=]\s*(true|false|True|False)/i)
    ?? window.match(/idempotent_hint\s*[:=]\s*(true|false|True|False)/i);
  if (idempotent) annotations.idempotentHint = idempotent[1].toLowerCase() === "true";

  const openWorld = window.match(/openWorldHint\s*[:=]\s*(true|false|True|False)/i)
    ?? window.match(/open_world_hint\s*[:=]\s*(true|false|True|False)/i);
  if (openWorld) annotations.openWorldHint = openWorld[1].toLowerCase() === "true";

  return Object.keys(annotations).length > 0 ? annotations : undefined;
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

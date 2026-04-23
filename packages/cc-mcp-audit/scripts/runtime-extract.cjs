#!/usr/bin/env node
/**
 * Sandboxed runtime extraction script.
 *
 * Usage: node runtime-extract.cjs <upstream-package> [repo-path]
 *
 * Requires the upstream package from the repo's node_modules and walks its
 * exports looking for tool definitions. Outputs JSON to stdout:
 *   [{ name: string, description: string, readOnly?: boolean }]
 *
 * Exit codes:
 *   0 - success (JSON on stdout, may be empty array)
 *   1 - error (message on stderr)
 *
 * This script uses CommonJS (require) because the target node_modules may
 * not support ESM. It is invoked as a subprocess by extractToolsRuntime().
 */

"use strict";

const path = require("path");

const pkgName = process.argv[2];
const repoPath = process.argv[3] || process.cwd();
// Additional import paths found in the wrapper's source code
const extraImportPaths = process.argv.slice(4);

if (!pkgName) {
  process.stderr.write("Usage: runtime-extract.cjs <package-name> [repo-path] [...import-paths]\n");
  process.exit(1);
}

/**
 * Attempt to require a module from the repo's node_modules.
 */
function requireFromRepo(specifier) {
  const resolved = require.resolve(specifier, {
    paths: [path.join(repoPath, "node_modules"), repoPath],
  });
  return require(resolved);
}

/**
 * Check if a value looks like a tool definition object.
 */
function isToolDef(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.name === "string" &&
    obj.name.length > 0
  );
}

/**
 * Extract tool definitions from a module's exports.
 * Walks the export tree looking for arrays of tool-like objects,
 * tool registry maps, and known introspection methods.
 */
function extractFromExports(mod) {
  const tools = [];
  const seenNames = new Set();
  const visitedObjects = new WeakSet();

  function collectTool(obj) {
    if (!obj || typeof obj !== "object") return;

    // Direct tool def: { name: "...", description: "..." }
    if (isToolDef(obj)) {
      if (seenNames.has(obj.name)) return;
      seenNames.add(obj.name);
      tools.push({
        name: obj.name,
        description: obj.description || "",
        readOnly: obj.readOnly != null ? Boolean(obj.readOnly) : undefined,
      });
      return;
    }

    // Nested schema pattern: { schema: { name: "...", description: "..." } }
    if (obj.schema && isToolDef(obj.schema)) {
      if (seenNames.has(obj.schema.name)) return;
      seenNames.add(obj.schema.name);
      tools.push({
        name: obj.schema.name,
        description: obj.schema.description || "",
        readOnly: obj.schema.readOnly != null ? Boolean(obj.schema.readOnly) : undefined,
      });
    }
  }

  function walkValue(val, depth) {
    if (depth > 4 || val == null) return;
    if (typeof val !== "object" && typeof val !== "function") return;

    // Prevent cycles and re-visiting the same object
    if (typeof val === "object") {
      if (visitedObjects.has(val)) return;
      visitedObjects.add(val);
    }

    // Array of tool-like objects
    if (Array.isArray(val)) {
      for (const item of val) {
        collectTool(item);
      }
      return;
    }

    // Object: check if it's a tool def, then walk properties
    if (typeof val === "object") {
      collectTool(val);

      // Only recurse into properties whose keys suggest tool content.
      // This avoids exploring massive runtime objects (class instances, etc.)
      const keys = Object.keys(val);
      for (const key of keys) {
        try {
          const child = val[key];
          if (child == null || typeof child !== "object") continue;
          if (Array.isArray(child)) {
            walkValue(child, depth + 1);
          } else if (isToolRelatedKey(key)) {
            walkValue(child, depth + 1);
          } else {
            // Still check the direct child as a potential tool def
            collectTool(child);
          }
        } catch {
          // Property access may throw (getters, proxies)
        }
      }
    }

    // Known introspection methods
    for (const methodName of ["getTools", "listTools", "tools"]) {
      try {
        if (typeof val[methodName] === "function") {
          const result = val[methodName]();
          if (Array.isArray(result)) {
            walkValue(result, depth + 1);
          }
        } else if (Array.isArray(val[methodName])) {
          walkValue(val[methodName], depth + 1);
        }
      } catch {
        // Method may throw without proper initialization
      }
    }
  }

  walkValue(mod, 0);

  // If module has a default export, walk that too
  if (mod && mod.default && mod.default !== mod) {
    walkValue(mod.default, 0);
  }

  return tools;
}

/**
 * Check if an object key suggests tool-related content worth recursing into.
 */
function isToolRelatedKey(key) {
  return /tool|mcp|server|command|handler|definition|registry|schema|browser/i.test(key);
}

// Main
try {
  // Collect tools from the package root and any additional import paths.
  // The root export may be a runtime object (not the tool registry),
  // so we also try wrapper-discovered import paths and common sub-paths.
  const allTools = [];
  const seenNames = new Set();

  function mergeTools(extracted) {
    for (const t of extracted) {
      if (!seenNames.has(t.name)) {
        seenNames.add(t.name);
        allTools.push(t);
      }
    }
  }

  // Try package root
  try {
    const rootMod = requireFromRepo(pkgName);
    mergeTools(extractFromExports(rootMod));
  } catch {
    // Package root not requireable
  }

  // Always also try import paths found in the wrapper's source
  const subPaths = [
    ...extraImportPaths,
    pkgName + "/tools",
    pkgName + "/lib/tools",
    pkgName + "/dist/tools",
    pkgName + "/src/tools",
  ];
  for (const sub of subPaths) {
    try {
      const subMod = requireFromRepo(sub);
      mergeTools(extractFromExports(subMod));
    } catch {
      // Sub-path not available
    }
  }

  process.stdout.write(JSON.stringify(allTools));
  process.exit(0);
} catch (err) {
  process.stderr.write("Runtime extraction error: " + (err.message || String(err)) + "\n");
  process.stdout.write("[]");
  process.exit(0); // Graceful degradation -- empty tools, not crash
}

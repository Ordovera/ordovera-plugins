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

if (!pkgName) {
  process.stderr.write("Usage: runtime-extract.cjs <package-name> [repo-path]\n");
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
  const seen = new Set();

  function collectTool(obj) {
    if (!isToolDef(obj)) return;
    if (seen.has(obj.name)) return;
    seen.add(obj.name);
    tools.push({
      name: obj.name,
      description: obj.description || "",
      readOnly: obj.readOnly != null ? Boolean(obj.readOnly) : undefined,
    });
  }

  function walkValue(val, depth) {
    if (depth > 3 || val == null) return;
    if (typeof val !== "object" && typeof val !== "function") return;

    // Array of tool-like objects
    if (Array.isArray(val)) {
      for (const item of val) {
        collectTool(item);
      }
      return;
    }

    // Map/object of tool-like objects (keyed by name)
    if (typeof val === "object" && !Array.isArray(val)) {
      // Check if val itself is a tool def
      collectTool(val);

      // Walk own enumerable properties
      for (const key of Object.keys(val)) {
        try {
          const child = val[key];
          if (Array.isArray(child)) {
            walkValue(child, depth + 1);
          } else if (isToolDef(child)) {
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

// Main
try {
  // Try the package directly
  let mod;
  try {
    mod = requireFromRepo(pkgName);
  } catch {
    // Try common sub-paths
    const subPaths = [
      pkgName + "/tools",
      pkgName + "/lib/tools",
      pkgName + "/dist/tools",
      pkgName + "/src/tools",
    ];
    for (const sub of subPaths) {
      try {
        mod = requireFromRepo(sub);
        break;
      } catch {
        // Continue to next sub-path
      }
    }
  }

  if (!mod) {
    process.stdout.write("[]");
    process.exit(0);
  }

  const tools = extractFromExports(mod);
  process.stdout.write(JSON.stringify(tools));
  process.exit(0);
} catch (err) {
  process.stderr.write("Runtime extraction error: " + (err.message || String(err)) + "\n");
  process.stdout.write("[]");
  process.exit(0); // Graceful degradation -- empty tools, not crash
}

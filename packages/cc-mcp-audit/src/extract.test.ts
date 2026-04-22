import { describe, it, expect, afterEach } from "vitest";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  extractTools,
  detectUpstreamPackage,
  parseRuntimeOutput,
  extractToolsRuntime,
  extractTestToolNames,
} from "./extract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "..", "test-fixtures");

describe("extractTools", () => {
  describe("Python server", () => {
    const tools = extractTools(resolve(fixturesDir, "python-server"));

    it("extracts all tool definitions", () => {
      const names = tools.map((t) => t.name);
      expect(names).toContain("list_items");
      expect(names).toContain("create_item");
      expect(names).toContain("delete_item");
      expect(names).toContain("get_status");
      expect(names).toContain("execute_query");
    });

    it("extracts docstring descriptions", () => {
      const listItems = tools.find((t) => t.name === "list_items");
      expect(listItems?.description).toContain("List all items");
    });

    it("classifies read tools correctly", () => {
      const listItems = tools.find((t) => t.name === "list_items");
      expect(listItems?.classification).toBe("read");

      const getStatus = tools.find((t) => t.name === "get_status");
      expect(getStatus?.classification).toBe("read");
    });

    it("classifies write tools correctly", () => {
      const createItem = tools.find((t) => t.name === "create_item");
      expect(createItem?.classification).toBe("write");

      const deleteItem = tools.find((t) => t.name === "delete_item");
      expect(deleteItem?.classification).toBe("write");
    });

    it("detects sensitive keywords", () => {
      const deleteItem = tools.find((t) => t.name === "delete_item");
      expect(deleteItem?.sensitiveKeywords).toContain("delete");
    });

    it("includes source file and line info", () => {
      const listItems = tools.find((t) => t.name === "list_items");
      expect(listItems?.sourceFile).toContain("server.py");
      expect(listItems?.sourceLine).toBeGreaterThan(0);
    });

    it("extracts registration-style tool with description", () => {
      const execQuery = tools.find((t) => t.name === "execute_query");
      expect(execQuery).toBeDefined();
      expect(execQuery?.description).toContain("read-only SQL");
    });
  });

  describe("TypeScript server", () => {
    const tools = extractTools(resolve(fixturesDir, "ts-server"));

    it("extracts server.tool() definitions", () => {
      const names = tools.map((t) => t.name);
      expect(names).toContain("search_docs");
      expect(names).toContain("send_email");
      expect(names).toContain("update_record");
      expect(names).toContain("get_config");
    });

    it("extracts object-style definitions", () => {
      const names = tools.map((t) => t.name);
      expect(names).toContain("deploy_app");
      expect(names).toContain("check_health");
    });

    it("classifies search as read", () => {
      const search = tools.find((t) => t.name === "search_docs");
      expect(search?.classification).toBe("read");
    });

    it("classifies send as write", () => {
      const send = tools.find((t) => t.name === "send_email");
      expect(send?.classification).toBe("write");
    });

    it("classifies update as write", () => {
      const update = tools.find((t) => t.name === "update_record");
      expect(update?.classification).toBe("write");
    });

    it("classifies deploy as write", () => {
      const deploy = tools.find((t) => t.name === "deploy_app");
      expect(deploy?.classification).toBe("write");
    });

    it("extracts inline descriptions", () => {
      const search = tools.find((t) => t.name === "search_docs");
      expect(search?.description).toContain("Search documentation");
    });
  });

  describe("FastMCP server", () => {
    const tools = extractTools(resolve(fixturesDir, "fastmcp-server"));

    it("extracts multi-line decorator tools", () => {
      const names = tools.map((t) => t.name);
      expect(names).toContain("list_schemas");
      expect(names).toContain("get_object_details");
      expect(names).toContain("drop_table");
    });

    it("uses explicit name= when provided in multi-line decorator", () => {
      const names = tools.map((t) => t.name);
      expect(names).toContain("analyze_health");
      expect(names).not.toContain("analyze_db_health");
    });

    it("extracts description from decorator kwargs", () => {
      const listSchemas = tools.find((t) => t.name === "list_schemas");
      expect(listSchemas?.description).toContain("List all database schemas");
    });

    it("classifies read tools from multi-line decorators", () => {
      const listSchemas = tools.find((t) => t.name === "list_schemas");
      expect(listSchemas?.classification).toBe("read");

      const getDetails = tools.find((t) => t.name === "get_object_details");
      expect(getDetails?.classification).toBe("read");
    });

    it("classifies write tools from multi-line decorators", () => {
      const dropTable = tools.find((t) => t.name === "drop_table");
      expect(dropTable?.classification).toBe("write");
    });

    it("still handles bare @mcp.tool() decorators", () => {
      const getVersion = tools.find((t) => t.name === "get_version");
      expect(getVersion).toBeDefined();
      expect(getVersion?.classification).toBe("read");
    });

    it("extracts dynamically registered add_tool tools", () => {
      const execSql = tools.find((t) => t.name === "execute_sql");
      expect(execSql).toBeDefined();
      expect(execSql?.description).toContain("Execute any SQL query");
      // "execute" (write) + "query" (read) in description -- tied signals,
      // classifier defaults to read per existing tiebreak logic
      expect(execSql?.sensitiveKeywords).toContain("execute");
    });

    it("includes source file and line info", () => {
      const listSchemas = tools.find((t) => t.name === "list_schemas");
      expect(listSchemas?.sourceFile).toBe("server.py");
      expect(listSchemas?.sourceLine).toBeGreaterThan(0);
    });

    it("extracts the correct total count", () => {
      expect(tools.length).toBe(6);
    });
  });

  describe("no-tools server", () => {
    it("returns empty array when no tools found", () => {
      const tools = extractTools(resolve(fixturesDir, "no-tools-server"));
      expect(tools).toEqual([]);
    });
  });

  describe("wrapper server", () => {
    it("extracts no tools from a thin wrapper", () => {
      const tools = extractTools(resolve(fixturesDir, "wrapper-server"));
      expect(tools).toEqual([]);
    });
  });
});

describe("detectUpstreamPackage", () => {
  it("detects upstream package in a wrapper server", () => {
    const upstream = detectUpstreamPackage(resolve(fixturesDir, "wrapper-server"));
    expect(upstream).toBe("upstream-core");
  });

  it("returns null for a server with local tool definitions", () => {
    const upstream = detectUpstreamPackage(resolve(fixturesDir, "python-server"));
    expect(upstream).toBeNull();
  });

  it("returns null for a server with no package.json or deps", () => {
    const upstream = detectUpstreamPackage(resolve(fixturesDir, "no-tools-server"));
    expect(upstream).toBeNull();
  });

  it("returns null for framework-no-tools (dynamic registration, no wrapper import)", () => {
    const upstream = detectUpstreamPackage(resolve(fixturesDir, "framework-no-tools"));
    expect(upstream).toBeNull();
  });

  it("returns null for ts-framework-no-tools (no package.json deps)", () => {
    const upstream = detectUpstreamPackage(resolve(fixturesDir, "ts-framework-no-tools"));
    expect(upstream).toBeNull();
  });

  it("detects upstream package in a Python wrapper", () => {
    const upstream = detectUpstreamPackage(resolve(fixturesDir, "python-wrapper-server"));
    expect(upstream).toBe("mcp_core");
  });

  it("returns null for ts-server (has tools, not a wrapper)", () => {
    const upstream = detectUpstreamPackage(resolve(fixturesDir, "ts-server"));
    expect(upstream).toBeNull();
  });

  it("returns null for fastmcp-server (has tools, not a wrapper)", () => {
    const upstream = detectUpstreamPackage(resolve(fixturesDir, "fastmcp-server"));
    expect(upstream).toBeNull();
  });

  describe("edge cases with temp fixtures", () => {
    const tmpBase = join(tmpdir(), "cc-mcp-audit-test-wrapper");
    const dirs: string[] = [];

    function makeTempFixture(name: string, files: Record<string, string>): string {
      const dir = join(tmpBase, name + "-" + Date.now());
      mkdirSync(dir, { recursive: true });
      dirs.push(dir);
      for (const [path, content] of Object.entries(files)) {
        const fullPath = join(dir, path);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content);
      }
      return dir;
    }

    afterEach(() => {
      for (const d of dirs) {
        rmSync(d, { recursive: true, force: true });
      }
      dirs.length = 0;
    });

    it("detects scoped package as upstream", () => {
      const dir = makeTempFixture("scoped", {
        "package.json": JSON.stringify({
          dependencies: { "@playwright/mcp-core": "^1.0.0" },
        }),
        "src/index.js": [
          'import { tools } from "@playwright/mcp-core/lib/tools";',
          "tools.forEach(t => server.registerTool(t));",
        ].join("\n"),
      });
      expect(detectUpstreamPackage(dir)).toBe("@playwright/mcp-core");
    });

    it("ignores files over 50 non-blank lines", () => {
      const longFile = [
        'import { tools } from "upstream-core/lib/tools";',
        "tools.forEach(t => server.registerTool(t));",
        ...Array(50).fill("const x = 1;"),
      ].join("\n");
      const dir = makeTempFixture("large-file", {
        "package.json": JSON.stringify({
          dependencies: { "upstream-core": "^1.0.0" },
        }),
        "src/index.js": longFile,
      });
      expect(detectUpstreamPackage(dir)).toBeNull();
    });

    it("returns null when import is from a dep but not MCP-related", () => {
      const dir = makeTempFixture("non-mcp-dep", {
        "package.json": JSON.stringify({
          dependencies: { "lodash": "^4.0.0" },
        }),
        "src/index.js": [
          'import { merge } from "lodash";',
          "console.log(merge({}, {}));",
        ].join("\n"),
      });
      expect(detectUpstreamPackage(dir)).toBeNull();
    });

    it("returns null when import is not a declared dependency", () => {
      const dir = makeTempFixture("undeclared-dep", {
        "package.json": JSON.stringify({
          dependencies: {},
        }),
        "src/index.js": [
          'import { tools } from "upstream-core/lib/tools";',
          "tools.forEach(t => server.registerTool(t));",
        ].join("\n"),
      });
      expect(detectUpstreamPackage(dir)).toBeNull();
    });

    it("detects upstream via require() syntax", () => {
      const dir = makeTempFixture("require-syntax", {
        "package.json": JSON.stringify({
          dependencies: { "mcp-tools": "^1.0.0" },
        }),
        "src/index.js": [
          'const tools = require("mcp-tools/lib/tools");',
          "tools.forEach(t => server.registerTool(t));",
        ].join("\n"),
      });
      expect(detectUpstreamPackage(dir)).toBe("mcp-tools");
    });

    it("detects upstream from devDependencies", () => {
      const dir = makeTempFixture("dev-dep", {
        "package.json": JSON.stringify({
          devDependencies: { "mcp-core": "^2.0.0" },
        }),
        "src/index.js": [
          'import { tools } from "mcp-core/lib/server";',
          "tools.forEach(t => server.registerTool(t));",
        ].join("\n"),
      });
      expect(detectUpstreamPackage(dir)).toBe("mcp-core");
    });

    it("skips MCP framework packages and finds the real upstream", () => {
      const dir = makeTempFixture("framework-skip", {
        "package.json": JSON.stringify({
          dependencies: {
            "@modelcontextprotocol/sdk": "^1.0.0",
            "playwright-core": "^1.50.0",
          },
        }),
        "src/index.js": [
          'const { tools } = require("playwright-core/lib/coreBundle");',
          "module.exports = { createConnection: tools.createConnection };",
        ].join("\n"),
      });
      expect(detectUpstreamPackage(dir)).toBe("playwright-core");
    });

    it("skips test files when detecting wrapper", () => {
      const dir = makeTempFixture("test-file-skip", {
        "package.json": JSON.stringify({
          dependencies: {
            "some-mcp-tools": "^1.0.0",
          },
          devDependencies: {
            "@modelcontextprotocol/sdk": "^1.0.0",
          },
        }),
        // Test file imports SDK -- should be skipped
        "src/server.test.ts": [
          'import { Client } from "@modelcontextprotocol/sdk/client";',
          "const client = new Client();",
        ].join("\n"),
        // Source file imports actual upstream
        "src/index.js": [
          'const { tools } = require("some-mcp-tools/lib/tools");',
          "module.exports = tools;",
        ].join("\n"),
      });
      expect(detectUpstreamPackage(dir)).toBe("some-mcp-tools");
    });

    it("finds deps from nested package.json in monorepo", () => {
      const dir = makeTempFixture("monorepo", {
        "package.json": JSON.stringify({
          devDependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
        }),
        "packages/server/package.json": JSON.stringify({
          dependencies: { "upstream-tools": "^1.0.0" },
        }),
        "packages/server/index.js": [
          'const { tools } = require("upstream-tools/lib/core");',
          "module.exports = { start: tools.start };",
        ].join("\n"),
      });
      expect(detectUpstreamPackage(dir)).toBe("upstream-tools");
    });
  });
});

describe("parseRuntimeOutput", () => {
  it("parses valid tool array", () => {
    const json = JSON.stringify([
      { name: "browser_click", description: "Click an element" },
      { name: "browser_navigate", description: "Navigate to URL", readOnly: true },
    ]);
    const { tools, parseWarnings } = parseRuntimeOutput(json, "upstream-core");
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("browser_click");
    expect(tools[0].description).toBe("Click an element");
    expect(tools[0].sourceFile).toBe("[runtime:upstream-core]");
    expect(tools[0].sourceLine).toBe(0);
    expect(tools[1].name).toBe("browser_navigate");
    expect(parseWarnings).toEqual([]);
  });

  it("classifies runtime-extracted tools using buildTool logic", () => {
    const json = JSON.stringify([
      { name: "delete_file", description: "Delete a file from disk" },
      { name: "list_files", description: "List files in directory" },
    ]);
    const { tools } = parseRuntimeOutput(json, "pkg");
    expect(tools[0].classification).toBe("write");
    expect(tools[0].sensitiveKeywords).toContain("delete");
    expect(tools[1].classification).toBe("read");
  });

  it("returns empty array for empty JSON array", () => {
    const { tools, parseWarnings } = parseRuntimeOutput("[]", "pkg");
    expect(tools).toEqual([]);
    expect(parseWarnings).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    const { tools, parseWarnings } = parseRuntimeOutput("", "pkg");
    expect(tools).toEqual([]);
    expect(parseWarnings).toEqual([]);
  });

  it("warns on invalid JSON", () => {
    const { tools, parseWarnings } = parseRuntimeOutput("not json", "pkg");
    expect(tools).toEqual([]);
    expect(parseWarnings.some((w) => w.includes("could not parse"))).toBe(true);
  });

  it("warns on non-array JSON", () => {
    const { tools, parseWarnings } = parseRuntimeOutput('{"name":"x"}', "pkg");
    expect(tools).toEqual([]);
    expect(parseWarnings.some((w) => w.includes("not an array"))).toBe(true);
  });

  it("skips items without a name field", () => {
    const json = JSON.stringify([
      { name: "valid_tool", description: "A tool" },
      { description: "Missing name" },
      "not an object",
      null,
    ]);
    const { tools } = parseRuntimeOutput(json, "pkg");
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("valid_tool");
  });
});

describe("extractToolsRuntime", () => {
  const tmpBase = join(tmpdir(), "cc-mcp-audit-test-runtime");
  const dirs: string[] = [];

  function makeTempFixture(name: string, files: Record<string, string>): string {
    const dir = join(tmpBase, name + "-" + Date.now());
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(dir, path);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content);
    }
    return dir;
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("returns empty tools with warning when no package.json", () => {
    const dir = makeTempFixture("no-pkg", {
      "src/index.js": "console.log('hi');",
    });
    const { tools, runtimeWarnings } = extractToolsRuntime(dir, "some-pkg");
    expect(tools).toEqual([]);
    expect(runtimeWarnings.some((w) => w.includes("no package.json"))).toBe(true);
  });

  it("extracts tools from a mock upstream package with node_modules", () => {
    // Create a fake node_modules/fake-mcp-tools/index.js that exports tool defs
    const dir = makeTempFixture("mock-upstream", {
      "package.json": JSON.stringify({ dependencies: { "fake-mcp-tools": "1.0.0" } }),
      "node_modules/fake-mcp-tools/index.js": [
        "module.exports = {",
        "  tools: [",
        '    { name: "read_data", description: "Read data from source" },',
        '    { name: "write_data", description: "Write data to destination" },',
        "  ]",
        "};",
      ].join("\n"),
      "node_modules/fake-mcp-tools/package.json": JSON.stringify({
        name: "fake-mcp-tools",
        main: "index.js",
      }),
    });

    const { tools, runtimeWarnings } = extractToolsRuntime(dir, "fake-mcp-tools");
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(["read_data", "write_data"]);
    expect(tools[0].sourceFile).toBe("[runtime:fake-mcp-tools]");
    expect(runtimeWarnings.some((w) => w.includes("found 2 tool(s)"))).toBe(true);
  });

  it("skips npm install when node_modules already exists", () => {
    // With node_modules present, it should not try to npm install
    const dir = makeTempFixture("has-node-modules", {
      "package.json": JSON.stringify({ dependencies: { "nonexistent-pkg": "1.0.0" } }),
      "node_modules/.package-lock.json": "{}",
    });

    const { tools } = extractToolsRuntime(dir, "nonexistent-pkg");
    // Should return empty (package not actually installed) but not crash
    expect(tools).toEqual([]);
  });
});

describe("extractTestToolNames", () => {
  it("extracts tool names from Python test file with assertions", () => {
    const results = extractTestToolNames(resolve(fixturesDir, "server-with-tests"));
    expect(results.length).toBeGreaterThan(0);

    const allNames = results.flatMap((r) => r.names);
    expect(allNames).toContain("list_users");
    expect(allNames).toContain("create_user");
    expect(allNames).toContain("delete_user");
    expect(allNames).toContain("get_status");
    expect(allNames).toContain("export_data");
  });

  it("includes source file path", () => {
    const results = extractTestToolNames(resolve(fixturesDir, "server-with-tests"));
    expect(results.some((r) => r.sourceFile.includes("test_tools.py"))).toBe(true);
  });

  it("returns empty for repos without test files", () => {
    const results = extractTestToolNames(resolve(fixturesDir, "no-tools-server"));
    expect(results).toEqual([]);
  });

  it("returns empty for repos where test files have no tool-like names", () => {
    const results = extractTestToolNames(resolve(fixturesDir, "python-server"));
    // python-server has no test files
    expect(results).toEqual([]);
  });

  describe("edge cases with temp fixtures", () => {
    const tmpBase = join(tmpdir(), "cc-mcp-audit-test-testtools");
    const dirs: string[] = [];

    function makeTempFixture(name: string, files: Record<string, string>): string {
      const dir = join(tmpBase, name + "-" + Date.now());
      mkdirSync(dir, { recursive: true });
      dirs.push(dir);
      for (const [path, content] of Object.entries(files)) {
        const fullPath = join(dir, path);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content);
      }
      return dir;
    }

    afterEach(() => {
      for (const d of dirs) {
        rmSync(d, { recursive: true, force: true });
      }
      dirs.length = 0;
    });

    it("extracts from JS/TS test files with toContain assertions", () => {
      const dir = makeTempFixture("js-tests", {
        "src/server.test.ts": [
          'import { expect, it } from "vitest";',
          "it('has all tools', () => {",
          "  const names = getToolNames();",
          '  expect(names).toContain("list_items");',
          '  expect(names).toContain("create_item");',
          '  expect(names).toContain("delete_item");',
          "});",
        ].join("\n"),
      });
      const results = extractTestToolNames(dir);
      const allNames = results.flatMap((r) => r.names);
      expect(allNames).toContain("list_items");
      expect(allNames).toContain("create_item");
      expect(allNames).toContain("delete_item");
    });

    it("extracts from array near toEqual", () => {
      const dir = makeTempFixture("array-assert", {
        "test/tools.spec.js": [
          'const expected = ["browser_click", "browser_navigate", "file_read"];',
          "expect(toolNames).toEqual(expected);",
        ].join("\n"),
      });
      const results = extractTestToolNames(dir);
      const allNames = results.flatMap((r) => r.names);
      expect(allNames).toContain("browser_click");
      expect(allNames).toContain("browser_navigate");
      expect(allNames).toContain("file_read");
    });

    it("does not extract non-tool-like names", () => {
      const dir = makeTempFixture("non-tool-names", {
        "test_config.py": [
          "def test_config():",
          '    values = ["red", "blue", "green"]',
          "    assert values == expected",
        ].join("\n"),
      });
      const results = extractTestToolNames(dir);
      // Single words without underscores/hyphens should be filtered out
      const allNames = results.flatMap((r) => r.names);
      expect(allNames).not.toContain("red");
      expect(allNames).not.toContain("blue");
      expect(allNames).not.toContain("green");
    });

    it("handles __tests__ directory", () => {
      const dir = makeTempFixture("dunder-tests", {
        "__tests__/tools.test.ts": [
          "expect(names).toContain('list_records');",
          "expect(names).toContain('update_record');",
        ].join("\n"),
      });
      const results = extractTestToolNames(dir);
      const allNames = results.flatMap((r) => r.names);
      expect(allNames).toContain("list_records");
      expect(allNames).toContain("update_record");
    });

    it("extracts from multi-line arrays spanning 20+ lines", () => {
      const dir = makeTempFixture("multiline-array", {
        "test/capabilities.spec.ts": [
          "it('has all tools', () => {",
          "  expect(new Set(tools.map(t => t.name))).toEqual(new Set([",
          "    'browser_click',",
          "    'browser_navigate',",
          "    'browser_snapshot',",
          "    'browser_take_screenshot',",
          "    'browser_fill_form',",
          "    'browser_press_key',",
          "    'browser_hover',",
          "    'browser_drag',",
          "    'browser_select_option',",
          "    'browser_type',",
          "    'browser_close',",
          "    'browser_navigate_back',",
          "    'browser_tabs',",
          "    'browser_wait_for',",
          "    'browser_resize',",
          "    'browser_evaluate',",
          "    'browser_console_messages',",
          "    'browser_network_requests',",
          "    'browser_file_upload',",
          "    'browser_handle_dialog',",
          "    'browser_run_code',",
          "  ]));",
          "});",
        ].join("\n"),
      });
      const results = extractTestToolNames(dir);
      const allNames = results.flatMap((r) => r.names);
      expect(allNames).toHaveLength(21);
      expect(allNames).toContain("browser_click");
      expect(allNames).toContain("browser_run_code");
      expect(allNames).toContain("browser_navigate_back");
    });

    it("extracts tool names from callTool({ name: '...' }) pattern", () => {
      const dir = makeTempFixture("calltool-pattern", {
        "test/tools.spec.ts": [
          "it('navigates', async () => {",
          "  expect(await client.callTool({",
          "    name: 'browser_navigate',",
          "    arguments: { url: 'http://example.com' },",
          "  }));",
          "});",
          "it('clicks', async () => {",
          "  const result = await client.callTool({ name: 'browser_click', arguments: { ref: 'btn' } });",
          "  expect(result).toBeDefined();",
          "});",
        ].join("\n"),
      });
      const results = extractTestToolNames(dir);
      const allNames = results.flatMap((r) => r.names);
      expect(allNames).toContain("browser_navigate");
      expect(allNames).toContain("browser_click");
    });
  });
});

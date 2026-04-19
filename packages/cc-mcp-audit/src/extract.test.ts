import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractTools } from "./extract.js";

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
});

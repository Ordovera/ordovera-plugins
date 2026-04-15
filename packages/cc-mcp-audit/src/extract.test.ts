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

  describe("no-tools server", () => {
    it("returns empty array when no tools found", () => {
      const tools = extractTools(resolve(fixturesDir, "no-tools-server"));
      expect(tools).toEqual([]);
    });
  });
});

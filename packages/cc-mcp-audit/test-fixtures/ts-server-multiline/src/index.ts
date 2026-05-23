// Multi-line tool registration pattern (Pattern A).
// Modern MCP TS servers use this form when descriptions or schemas are long.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "ts-multiline-test", version: "0.1.0" });

server.tool(
  "search_repositories",
  "Search public GitHub repositories by query string and optional language filter.",
  {
    query: z.string().describe("Search query"),
    language: z.string().optional(),
  },
  async ({ query }) => {
    return { content: [{ type: "text", text: `Searching for ${query}` }] };
  },
);

server.tool(
  "create_issue",
  "Create a new issue in the specified repository.",
  {
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    body: z.string(),
  },
  async (input) => {
    return { content: [{ type: "text", text: `Created issue in ${input.repo}` }] };
  },
);

// registerTool form (multi-line)
server.registerTool(
  "delete_branch",
  {
    description: "Permanently delete a branch from the repository.",
    inputSchema: { branch: z.string() },
  },
  async ({ branch }) => {
    return { content: [{ type: "text", text: `Deleted ${branch}` }] };
  },
);

// Edge case: blank lines between .tool( and the name should not break extraction
server.tool(

  "list_branches",
  "List all branches in the repository.",
  {},
  async () => {
    return { content: [{ type: "text", text: "branches" }] };
  },
);

// Documented limitation: variable-referenced name. This should NOT be
// extracted by Pattern A (no quoted literal as first arg).
const dynamicToolName = "noop";
server.tool(
  dynamicToolName,
  "This tool's name comes from a variable -- Pattern A does not resolve.",
  {},
  async () => ({ content: [] }),
);

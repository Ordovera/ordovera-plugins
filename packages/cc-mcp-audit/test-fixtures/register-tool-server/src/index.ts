import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer(
  {
    name: "MyServer",
    description: "A test server that should not be extracted as a tool",
  }
);

server.registerTool(
  "resolve-library-id",
  {
    title: "Resolve Library ID",
    description: "Resolve a library name to an ID",
    inputSchema: {
      query: { type: "string" },
    },
  },
  async ({ query }) => {
    return { content: [{ type: "text", text: query }] };
  }
);

server.registerTool("query-docs", {
  description: "Query documentation for a library",
  inputSchema: {
    libraryId: { type: "string" },
  },
}, async ({ libraryId }) => {
  return { content: [{ type: "text", text: libraryId }] };
});

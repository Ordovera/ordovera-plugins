// Pattern G fixture: server.ts builds a `const tools = [{ name: IDENT, ... }, ...]`
// from imported identifiers, then iterates with `server.tool(tool.name, ...)`.
// Each name identifier is resolved cross-file via the import map.
//
// Real-world example: cyberash-dev/moex-mcp.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  searchUsersToolName,
  searchUsersToolDescription,
  searchUsersToolSchema,
  createSearchUsersHandler,
} from "./features/search-users/handler.js";
import {
  getUserToolName,
  getUserToolDescription,
  getUserToolSchema,
  createGetUserHandler,
} from "./features/get-user/handler.js";
import {
  listGroupsToolName,
  listGroupsToolDescription,
  listGroupsToolSchema,
  createListGroupsHandler,
} from "./features/list-groups/handler.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "array-loop-test", version: "0.1.0" });

  const tools = [
    {
      name: searchUsersToolName,
      description: searchUsersToolDescription,
      schema: searchUsersToolSchema,
      handler: createSearchUsersHandler(),
    },
    {
      name: getUserToolName,
      description: getUserToolDescription,
      schema: getUserToolSchema,
      handler: createGetUserHandler(),
    },
    {
      name: listGroupsToolName,
      description: listGroupsToolDescription,
      schema: listGroupsToolSchema,
      handler: createListGroupsHandler(),
    },
  ];

  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
  }

  return server;
}

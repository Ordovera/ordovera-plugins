// Pattern H fixture: manifest-driven tool registration.
// A record literal acts as the tool registry; an Object.entries loop
// registers each entry on the server. Tool names are the top-level keys
// of the record, with a spread of an imported record that contributes
// additional keys.
//
// Real-world example: listbee-dev/listbee-mcp.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { schemas } from "./generated/schemas.js";
import { z } from "zod";

const schemaMap: Record<string, unknown> = {
  ...schemas,
  upload_file: z.object({
    type: z.enum(["public_asset", "private_deliverable"]),
    source_url: z.string(),
  }).strict(),
};

export function createServer(): McpServer {
  const server = new McpServer({ name: "record-loop-test", version: "0.1.0" });

  for (const [toolName, schema] of Object.entries(schemaMap)) {
    server.registerTool(toolName, {
      description: `Auto-registered ${toolName}`,
    }, async () => ({ content: [{ type: "text", text: "ok" }] }));
  }

  return server;
}

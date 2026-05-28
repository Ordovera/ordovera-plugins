// Pattern L fixture (inline tools array): low-level setRequestHandler(ListTools)
// returning an inline `tools: [...]` array. Tool objects intentionally have NO
// `description` field, so the object-style matcher cannot fire -- this isolates
// Pattern L. The inputSchema contains nested `name:` props that MUST be ignored
// (they sit below element-object depth).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "weather", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_forecast",
      inputSchema: {
        type: "object",
        properties: {
          location: { type: "string", name: "loc_field" },
          name: { type: "string" },
        },
      },
    },
    {
      name: "create_alert",
      inputSchema: {
        type: "object",
        properties: { threshold: { type: "number" } },
      },
    },
  ],
}));

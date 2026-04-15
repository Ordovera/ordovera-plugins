import { Server } from "@modelcontextprotocol/sdk/server";

const server = new Server({ name: "ts-test-server" });

server.tool("search_docs", "Search documentation by keyword", {
  keyword: { type: "string" },
}, async ({ keyword }) => {
  return { results: [] };
});

server.tool("send_email", "Send an email to the specified recipient", {
  to: { type: "string" },
  body: { type: "string" },
}, async ({ to, body }) => {
  console.log(`Sending email to ${to}`);
  return { sent: true };
});

server.tool("update_record", "Modify an existing database record", {
  id: { type: "number" },
  data: { type: "object" },
}, async ({ id, data }) => {
  return { updated: true };
});

server.tool("get_config",
  "Read the current configuration",
  {},
  async () => {
    return { debug: false };
  }
);

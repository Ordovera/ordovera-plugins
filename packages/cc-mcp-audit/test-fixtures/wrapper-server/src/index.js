import { createServer } from "@modelcontextprotocol/sdk/server";
import { tools } from "upstream-core/lib/tools";

const server = createServer({ name: "wrapper-server" });

// Re-export upstream tools -- no local tool definitions
tools.forEach(tool => server.registerTool(tool));

server.start();

import { Server } from "@modelcontextprotocol/sdk/server";

const server = new Server({ name: "dynamic-ts-server" });

// Tools loaded from config at runtime
const toolDefs = loadToolsFromConfig();
toolDefs.forEach(def => server.registerTool(def));

// Pattern Q fixture: local registerTool wrapper with the literal tool name in
// the 3rd positional slot (server, registry, "name", config, handler).
// Mirrors lcm2m/lcm2m-caddis-mcp.
import { registerTool, type ToolHandlerRegistry } from "../registry.js";

export function registerDeviceTools(
  server: unknown,
  registry: ToolHandlerRegistry,
): void {
  registerTool(
    server,
    registry,
    "caddis_list_devices",
    {
      title: "List devices",
      description: "List all physical devices registered to the company.",
      inputSchema: {},
    },
    async () => ({ devices: [] }),
  );

  registerTool(
    server,
    registry,
    "caddis_get_device",
    {
      title: "Get one device",
      description: "Fetch a single device by ID.",
      inputSchema: { deviceId: "string" },
    },
    async () => ({ device: null }),
  );

  registerTool(
    server,
    registry,
    "caddis_create_device",
    {
      title: "Create device",
      description: "Register a new physical device.",
      inputSchema: { name: "string" },
    },
    async () => ({ created: true }),
  );
}

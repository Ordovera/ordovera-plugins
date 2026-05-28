// Pattern F fixture: local registerTool wrapper called with same-file
// const-defined name + description identifiers.
//
// The wrapper is imported from a LOCAL path (`./register.js`). The current
// SDK matcher only fires on `.registerTool("literal", ...)` method calls,
// so this bare-function form is missed without Pattern F.
//
// Real-world example: wearehoust/front-mcp.
import { z } from "zod";
import { registerTool } from "./register.js";

const TOOL_NAME = "channels";
const DESCRIPTION =
  "Manage channels — list, get, create, update, validate channels.";

export function registerChannelsTool(
  server: unknown,
): void {
  registerTool(
    server,
    TOOL_NAME,
    DESCRIPTION,
    {
      action: z.enum(["list", "get", "create", "update"]).describe("The action to perform"),
      channel_id: z.string().optional(),
    },
    { readOnlyHint: false, destructiveHint: false },
    async (params) => {
      return { content: [{ type: "text" as const, text: "ok" }] };
    },
  );
}

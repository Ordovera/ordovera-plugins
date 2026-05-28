// Second tool file under the same Pattern F shape — multiple files in one
// repo all using the local-wrapper convention.
import { z } from "zod";
import { registerTool } from "./register.js";

const TOOL_NAME = "inboxes";
const DESCRIPTION = "Manage inboxes — list, get, create, update.";

export function registerInboxesTool(server: unknown): void {
  registerTool(
    server,
    TOOL_NAME,
    DESCRIPTION,
    { action: z.string(), inbox_id: z.string().optional() },
    { readOnlyHint: false },
    async (params) => ({ content: [{ type: "text" as const, text: "ok" }] }),
  );
}

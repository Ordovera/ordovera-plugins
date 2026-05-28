// Pattern E fixture: custom defineTool wrapper from a local shared module.
// Modern MCP TS servers wrap server.registerTool to inject middleware,
// sanitization, or annotation enforcement.
//
// Real-world example: klodr/mercury-invoicing-mcp.
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";

export function registerWidgetTools(server: unknown): void {
  defineTool(
    server,
    "widgets_list",
    "List all widgets in the workspace.",
    { limit: z.number().int().optional() },
    async (args) => textResult({ widgets: [] }),
    { readOnlyHint: true },
  );

  defineTool(
    server,
    "widgets_create",
    "Create a new widget with the supplied parameters.",
    { name: z.string(), color: z.enum(["red", "blue"]) },
    async (args) => textResult({ created: args.name }),
    { destructiveHint: false },
  );

  defineTool(
    server,
    "widgets_delete",
    "Permanently delete a widget.",
    { id: z.string() },
    async (args) => textResult({ deleted: args.id }),
    { destructiveHint: true },
  );
}

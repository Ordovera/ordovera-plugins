import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";

export const schema = {
  limit: z.number().int().optional().describe("Max results"),
};

export const metadata: ToolMetadata = {
  name: "list-widgets",
  description: "List widgets, optionally filtered by limit.",
  annotations: {
    title: "List widgets",
    readOnlyHint: true,
  },
};

export default async function listWidgets(_params: InferSchema<typeof schema>) {
  return JSON.stringify({ widgets: [] });
}

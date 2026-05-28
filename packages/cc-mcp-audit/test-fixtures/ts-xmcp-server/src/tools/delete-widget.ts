import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";

export const schema = {
  id: z.string().describe("Widget id to delete"),
};

export const metadata: ToolMetadata = {
  name: "delete-widget",
  description: "Permanently delete a widget by id.",
  annotations: {
    title: "Delete widget",
    readOnlyHint: false,
    destructiveHint: true,
  },
};

export default async function deleteWidget(_params: InferSchema<typeof schema>) {
  return JSON.stringify({ deleted: true });
}

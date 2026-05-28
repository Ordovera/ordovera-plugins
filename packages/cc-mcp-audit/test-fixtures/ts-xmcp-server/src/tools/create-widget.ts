import { z } from "zod";
import { type ToolMetadata, type InferSchema } from "xmcp";

export const schema = {
  name: z.string().describe("Widget name"),
  color: z.enum(["red", "blue", "green"]).describe("Widget color"),
};

export const metadata: ToolMetadata = {
  name: "create-widget",
  description: "Create a new widget in the workspace.",
  annotations: {
    title: "Create widget",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
};

export default async function createWidget(_params: InferSchema<typeof schema>) {
  return JSON.stringify({ created: true });
}

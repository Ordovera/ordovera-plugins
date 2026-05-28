export const listGroupsToolName = "list_groups";
export const listGroupsToolDescription = "List all groups, paginated.";
export const listGroupsToolSchema = { cursor: "string?" };
export function createListGroupsHandler() {
  return async () => ({ content: [{ type: "text", text: "[]" }] });
}

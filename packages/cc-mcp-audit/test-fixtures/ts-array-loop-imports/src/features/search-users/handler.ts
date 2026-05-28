export const searchUsersToolName = "search_users";
export const searchUsersToolDescription = "Search users by name or email.";
export const searchUsersToolSchema = { query: "string" };
export function createSearchUsersHandler() {
  return async () => ({ content: [{ type: "text", text: "[]" }] });
}

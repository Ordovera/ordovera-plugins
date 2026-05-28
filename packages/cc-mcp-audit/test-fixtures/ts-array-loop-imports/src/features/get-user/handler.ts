export const getUserToolName = "get_user";
export const getUserToolDescription = "Fetch a single user by id.";
export const getUserToolSchema = { id: "string" };
export function createGetUserHandler() {
  return async () => ({ content: [{ type: "text", text: "{}" }] });
}

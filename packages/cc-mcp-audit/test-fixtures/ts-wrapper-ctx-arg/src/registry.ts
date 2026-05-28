// Local registerTool wrapper that threads an extra `registry` context arg
// before the tool name. Pattern E/F gate on this being a LOCAL import.
export type ToolHandlerRegistry = Map<string, unknown>;

export function registerTool(
  _server: unknown,
  registry: ToolHandlerRegistry,
  name: string,
  config: unknown,
  handler: unknown,
): void {
  registry.set(name, { config, handler });
}

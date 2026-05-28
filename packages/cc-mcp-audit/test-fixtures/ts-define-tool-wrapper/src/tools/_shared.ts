// Wrapper definitions referenced by widgets.ts. Real fixtures don't need to
// type-check; this file just demonstrates the import shape Pattern E gates on.
export function defineTool(...args: unknown[]): void {}
export function textResult(data: unknown): unknown { return data; }

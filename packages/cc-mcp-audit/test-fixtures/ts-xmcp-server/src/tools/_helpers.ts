// Non-tool file in the tools directory — should be ignored.
// Has no `export const metadata` so Pattern I must skip it without producing
// a phantom tool name.
export function formatWidget(w: unknown): string {
  return JSON.stringify(w);
}

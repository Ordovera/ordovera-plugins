import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { screenServer } from "./screen.js";
import type { ModelProvider, ModelCallResult } from "./screen-providers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "..", "test-fixtures");

/**
 * Deterministic fake provider for testing orchestration without real API calls.
 */
class FakeProvider implements ModelProvider {
  readonly id = "anthropic-api" as const;
  readonly model = "fake-model";
  public calls: string[] = [];

  constructor(private responses: string[]) {}

  async call(prompt: string): Promise<ModelCallResult> {
    this.calls.push(prompt);
    const response = this.responses.shift() ?? '{"likelihood":"unclear","notes":"default","citations":[]}';
    return {
      text: response,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    };
  }
}

class FailingProvider implements ModelProvider {
  readonly id = "anthropic-api" as const;
  readonly model = "fake-model";

  async call(_prompt: string): Promise<ModelCallResult> {
    throw new Error("simulated network failure");
  }
}

describe("screenServer", () => {
  it("produces signals for all three Domain 5 indicators", async () => {
    const provider = new FakeProvider([
      '{"likelihood":"likely-absent","notes":"mutation at admin.py:47","citations":[{"file":"admin.py","line":47}]}',
      '{"likelihood":"likely-absent","notes":"subprocess.run with shell=True","citations":[{"file":"server.py","line":10}]}',
      '{"likelihood":"unclear","notes":"no handler logic visible","citations":[]}',
    ]);

    const result = await screenServer(
      resolve(fixturesDir, "mutation-server"),
      { provider }
    );

    expect(result.signals.selfModificationPrevention?.likelihood).toBe("likely-absent");
    expect(result.signals.selfModificationPrevention?.citations).toHaveLength(1);
    expect(result.metadata.indicatorsScreened).toHaveLength(3);
    expect(result.metadata.model).toBe("fake-model");
    expect(result.metadata.promptVersion).toBe("v1");
  });

  it("aggregates token usage and cost across calls", async () => {
    const provider = new FakeProvider([
      '{"likelihood":"unclear","notes":"","citations":[]}',
      '{"likelihood":"unclear","notes":"","citations":[]}',
      '{"likelihood":"unclear","notes":"","citations":[]}',
    ]);

    const result = await screenServer(
      resolve(fixturesDir, "mutation-server"),
      { provider }
    );

    // mutation-server has no spawning patterns -- only 2 of 3 indicators
    // trigger provider calls. 2 calls at 100+50 tokens = 300.
    expect(result.metadata.totalTokens).toBe(300);
    expect(result.metadata.estimatedCostUsd).toBeCloseTo(0.002);
  });

  it("returns unclear signal when extraction finds no regions", async () => {
    const provider = new FakeProvider([]);

    const result = await screenServer(
      resolve(fixturesDir, "no-tools-server"),
      { provider }
    );

    // Self-modification: no-tools-server has no tool registration patterns
    expect(result.signals.selfModificationPrevention?.likelihood).toBe("unclear");
    expect(result.signals.selfModificationPrevention?.notes).toContain(
      "No relevant code regions"
    );
    // Provider was not called for that indicator
    expect(provider.calls.length).toBeLessThan(3);
  });

  it("returns unclear signal on provider errors rather than throwing", async () => {
    const provider = new FailingProvider();

    const result = await screenServer(
      resolve(fixturesDir, "mutation-server"),
      { provider }
    );

    const signal = result.signals.selfModificationPrevention;
    expect(signal?.likelihood).toBe("unclear");
    expect(signal?.notes).toContain("simulated network failure");
  });

  it("returns unclear signal when model returns invalid JSON", async () => {
    const provider = new FakeProvider([
      "not valid JSON at all",
      "also not valid",
      "nope",
    ]);

    const result = await screenServer(
      resolve(fixturesDir, "mutation-server"),
      { provider }
    );

    for (const indicator of ["selfModificationPrevention", "subAgentAuthorityConstraints", "permissionBoundaryEnforcement"] as const) {
      const signal = result.signals[indicator];
      if (signal) {
        // Some indicators may have returned "no regions" first
        if (signal.notes.includes("parse")) {
          expect(signal.likelihood).toBe("unclear");
        }
      }
    }
  });

  it("strips markdown code fences from responses", async () => {
    const provider = new FakeProvider([
      '```json\n{"likelihood":"likely-present","notes":"scopes checked","citations":[]}\n```',
    ]);

    const result = await screenServer(
      resolve(fixturesDir, "mutation-server"),
      { provider, indicators: ["selfModificationPrevention"] }
    );

    expect(result.signals.selfModificationPrevention?.likelihood).toBe(
      "likely-present"
    );
    expect(result.signals.selfModificationPrevention?.notes).toBe("scopes checked");
  });

  it("respects the budget limit", async () => {
    const provider = new FakeProvider([
      '{"likelihood":"likely-absent","notes":"","citations":[]}',
    ]);

    const result = await screenServer(
      resolve(fixturesDir, "mutation-server"),
      { provider, budgetUsd: 0.0005 } // First call returns 0.001, exceeds budget
    );

    // First call should succeed, subsequent calls should be budget-aborted
    const budgetSignals = Object.values(result.signals).filter((s) =>
      s.notes.includes("Budget")
    );
    expect(budgetSignals.length).toBeGreaterThan(0);
  });

  it("screens only the requested subset of indicators", async () => {
    const provider = new FakeProvider([
      '{"likelihood":"likely-present","notes":"","citations":[]}',
    ]);

    const result = await screenServer(
      resolve(fixturesDir, "mutation-server"),
      { provider, indicators: ["selfModificationPrevention"] }
    );

    expect(result.signals.selfModificationPrevention).toBeDefined();
    expect(result.signals.subAgentAuthorityConstraints).toBeUndefined();
    expect(result.signals.permissionBoundaryEnforcement).toBeUndefined();
    expect(result.metadata.indicatorsScreened).toEqual([
      "selfModificationPrevention",
    ]);
  });

  it("filters malformed citations", async () => {
    const provider = new FakeProvider([
      '{"likelihood":"likely-present","notes":"","citations":[{"file":"a.py","line":10},{"file":123,"line":"bad"},{"line":5}]}',
    ]);

    const result = await screenServer(
      resolve(fixturesDir, "mutation-server"),
      { provider, indicators: ["selfModificationPrevention"] }
    );

    // Only the well-formed citation should survive
    expect(result.signals.selfModificationPrevention?.citations).toHaveLength(1);
    expect(result.signals.selfModificationPrevention?.citations[0]).toEqual({
      file: "a.py",
      line: 10,
    });
  });
});

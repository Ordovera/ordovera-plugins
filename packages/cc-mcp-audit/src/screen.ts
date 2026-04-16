import type {
  Domain5Indicator,
  ScreeningSignal,
  ScreeningMetadata,
} from "./types.js";
import type { ModelProvider } from "./screen-providers.js";
import { extractRegions, formatRegions } from "./screen-regions.js";
import { buildPrompt, PROMPT_VERSION } from "./screen-prompts.js";

const DOMAIN_5_INDICATORS: Domain5Indicator[] = [
  "selfModificationPrevention",
  "subAgentAuthorityConstraints",
  "permissionBoundaryEnforcement",
];

export interface ScreenResult {
  signals: Partial<Record<Domain5Indicator, ScreeningSignal>>;
  metadata: ScreeningMetadata;
}

export interface ScreenOptions {
  provider: ModelProvider;
  /** Optional upper bound on estimated cost before aborting (USD) */
  budgetUsd?: number;
  /** Subset of Domain 5 indicators to screen (default: all three) */
  indicators?: Domain5Indicator[];
}

/**
 * Run the LLM screening pass for one MCP server repo. Produces triage
 * signals and run metadata. Signals are hints for human reviewers -- they
 * are not coding values.
 */
export async function screenServer(
  repoPath: string,
  options: ScreenOptions
): Promise<ScreenResult> {
  const indicators = options.indicators ?? DOMAIN_5_INDICATORS;
  const signals: Partial<Record<Domain5Indicator, ScreeningSignal>> = {};

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let costReported = false;

  for (const indicator of indicators) {
    // Budget check before each call
    if (options.budgetUsd != null && totalCost >= options.budgetUsd) {
      signals[indicator] = {
        likelihood: "unclear",
        notes: `Budget of $${options.budgetUsd.toFixed(2)} reached before this indicator was screened.`,
        citations: [],
      };
      continue;
    }

    const regions = extractRegions(repoPath, indicator);
    if (regions.length === 0) {
      signals[indicator] = {
        likelihood: "unclear",
        notes: "No relevant code regions extracted.",
        citations: [],
      };
      continue;
    }

    const prompt = buildPrompt(indicator, formatRegions(regions));

    let result;
    try {
      result = await options.provider.call(prompt);
    } catch (err) {
      signals[indicator] = {
        likelihood: "unclear",
        notes: `Screening call failed: ${err instanceof Error ? err.message : String(err)}`,
        citations: [],
      };
      continue;
    }

    if (result.inputTokens) totalInput += result.inputTokens;
    if (result.outputTokens) totalOutput += result.outputTokens;
    if (result.costUsd != null) {
      totalCost += result.costUsd;
      costReported = true;
    }

    const parsed = parseModelResponse(result.text);
    if (parsed) {
      signals[indicator] = parsed;
    } else {
      signals[indicator] = {
        likelihood: "unclear",
        notes: "Model response could not be parsed as valid JSON.",
        citations: [],
      };
    }
  }

  return {
    signals,
    metadata: {
      model: options.provider.model,
      promptVersion: PROMPT_VERSION,
      totalTokens: totalInput + totalOutput,
      estimatedCostUsd: costReported ? totalCost : 0,
      indicatorsScreened: indicators,
    },
  };
}

/**
 * Parse a screening response into a ScreeningSignal. Tolerates common model
 * behaviors like code fences or leading/trailing prose.
 */
function parseModelResponse(text: string): ScreeningSignal | null {
  // Strip common wrappers
  let cleaned = text.trim();
  // Remove markdown code fence if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Find the first JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const obj = JSON.parse(jsonMatch[0]);
    if (
      typeof obj !== "object" ||
      obj == null ||
      !["likely-present", "likely-absent", "unclear"].includes(obj.likelihood)
    ) {
      return null;
    }

    return {
      likelihood: obj.likelihood,
      notes: typeof obj.notes === "string" ? obj.notes : "",
      citations: Array.isArray(obj.citations)
        ? obj.citations
            .filter(
              (c: unknown): c is { file: string; line: number } =>
                typeof c === "object" &&
                c != null &&
                typeof (c as { file?: unknown }).file === "string" &&
                typeof (c as { line?: unknown }).line === "number"
            )
            .map((c: { file: string; line: number }) => ({
              file: c.file,
              line: c.line,
            }))
        : [],
    };
  } catch {
    return null;
  }
}

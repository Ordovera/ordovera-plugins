import { execFileSync } from "node:child_process";

export interface ModelCallResult {
  /** Raw model response text */
  text: string;
  /** Input tokens used, if the provider reports it */
  inputTokens?: number;
  /** Output tokens used, if the provider reports it */
  outputTokens?: number;
  /** Cost in USD, if the provider reports it */
  costUsd?: number;
}

export interface ModelProvider {
  /** Provider identifier recorded in screeningMetadata */
  readonly id: "claude-code" | "anthropic-api";
  /** Model identifier used for the call */
  readonly model: string;
  /** Call the model with a prompt and return the response */
  call(prompt: string): Promise<ModelCallResult>;
}

/**
 * Claude Code provider: shells out to the `claude` CLI. Uses whatever auth
 * Claude Code is configured with (subscription or API key). Zero config for
 * subscription users, but token/cost reporting is approximate.
 */
export class ClaudeCodeProvider implements ModelProvider {
  readonly id = "claude-code" as const;
  readonly model: string;

  constructor(model: string = "claude-haiku-4-5-20251001") {
    this.model = model;
  }

  async call(prompt: string): Promise<ModelCallResult> {
    try {
      const output = execFileSync(
        "claude",
        ["-p", prompt, "--output-format", "json", "--model", this.model],
        {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024, // 10MB
          timeout: 120_000,
        }
      );

      const parsed = JSON.parse(output);
      // Claude Code returns { type: "result", subtype: "success", result: "...",
      //   total_cost_usd?: number, usage?: {...} }
      const text: string = parsed.result ?? parsed.text ?? "";
      const usage = parsed.usage ?? {};
      return {
        text,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        costUsd: parsed.total_cost_usd,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Claude Code CLI call failed: ${message}`);
    }
  }
}

/**
 * Anthropic API provider: direct HTTP call to api.anthropic.com.
 * Requires ANTHROPIC_API_KEY. Precise token/cost reporting.
 */
export class AnthropicApiProvider implements ModelProvider {
  readonly id = "anthropic-api" as const;
  readonly model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string = "claude-haiku-4-5-20251001") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async call(prompt: string): Promise<ModelCallResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Anthropic API call failed: HTTP ${response.status} ${response.statusText}: ${body}`
      );
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    const inputTokens = data.usage?.input_tokens;
    const outputTokens = data.usage?.output_tokens;
    const costUsd = estimateCostUsd(this.model, inputTokens, outputTokens);

    return { text, inputTokens, outputTokens, costUsd };
  }
}

/**
 * Detect whether the Claude Code CLI is available on PATH.
 * Used for auto-selection of the default provider.
 */
export function claudeCliAvailable(): boolean {
  try {
    execFileSync("claude", ["--version"], {
      stdio: "pipe",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Select a provider based on explicit choice or auto-detection.
 *
 * - "claude-code": use Claude Code CLI (must be on PATH and logged in)
 * - "anthropic-api": use direct API call (requires ANTHROPIC_API_KEY)
 * - "auto" (default): prefer Claude Code if available, else fall back to API
 */
export function selectProvider(
  choice: "claude-code" | "anthropic-api" | "auto",
  model: string = "claude-haiku-4-5-20251001"
): ModelProvider {
  if (choice === "claude-code") {
    if (!claudeCliAvailable()) {
      throw new Error(
        "Provider 'claude-code' requested but the `claude` CLI is not on PATH. Install Claude Code or use --llm-provider anthropic-api."
      );
    }
    return new ClaudeCodeProvider(model);
  }

  if (choice === "anthropic-api") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        "Provider 'anthropic-api' requires ANTHROPIC_API_KEY in the environment."
      );
    }
    return new AnthropicApiProvider(key, model);
  }

  // Auto: prefer Claude Code if available
  if (claudeCliAvailable()) {
    return new ClaudeCodeProvider(model);
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    return new AnthropicApiProvider(key, model);
  }

  throw new Error(
    "No LLM provider available: `claude` CLI is not on PATH and ANTHROPIC_API_KEY is not set. Install Claude Code or set ANTHROPIC_API_KEY."
  );
}

/**
 * Approximate cost estimation for the Anthropic API.
 * Pricing is approximate and may change; this is for reporting only.
 */
function estimateCostUsd(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined
): number | undefined {
  if (inputTokens == null || outputTokens == null) return undefined;

  // Rough per-million-token rates (USD). These are approximations for
  // cost-reporting purposes only. Update when the package is next revised.
  const rates: Record<string, { input: number; output: number }> = {
    "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
    "claude-haiku-4-5": { input: 1.0, output: 5.0 },
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
    "claude-opus-4-6": { input: 15.0, output: 75.0 },
  };

  const rate = rates[model];
  if (!rate) return undefined;

  return (
    (inputTokens / 1_000_000) * rate.input +
    (outputTokens / 1_000_000) * rate.output
  );
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  selectProvider,
  claudeCliAvailable,
  ClaudeCodeProvider,
  AnthropicApiProvider,
} from "./screen-providers.js";

describe("selectProvider", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalPath = process.env.PATH;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    process.env.PATH = originalPath;
  });

  it("returns AnthropicApiProvider when explicit anthropic-api and key is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const provider = selectProvider("anthropic-api");
    expect(provider.id).toBe("anthropic-api");
    expect(provider).toBeInstanceOf(AnthropicApiProvider);
  });

  it("throws when anthropic-api is requested without ANTHROPIC_API_KEY", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => selectProvider("anthropic-api")).toThrow(
      /ANTHROPIC_API_KEY/
    );
  });

  it("throws when claude-code is requested but CLI unavailable", () => {
    // Clear PATH so `claude` cannot be found
    process.env.PATH = "/nonexistent-path-for-testing";
    expect(() => selectProvider("claude-code")).toThrow(
      /claude.*CLI.*not on PATH/
    );
  });

  it("auto mode throws when neither provider is available", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.PATH = "/nonexistent-path-for-testing";
    expect(() => selectProvider("auto")).toThrow(
      /No LLM provider available/
    );
  });

  it("auto mode falls back to API provider when CLI unavailable but key set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.PATH = "/nonexistent-path-for-testing";
    const provider = selectProvider("auto");
    expect(provider.id).toBe("anthropic-api");
  });

  it("accepts a custom model argument", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.PATH = "/nonexistent-path-for-testing";
    const provider = selectProvider("auto", "claude-sonnet-4-6");
    expect(provider.model).toBe("claude-sonnet-4-6");
  });
});

describe("claudeCliAvailable", () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it("returns false when claude is not on PATH", () => {
    process.env.PATH = "/nonexistent-path-for-testing";
    expect(claudeCliAvailable()).toBe(false);
  });
});

describe("AnthropicApiProvider", () => {
  it("stores model and uses default when unspecified", () => {
    const p = new AnthropicApiProvider("key");
    expect(p.model).toBe("claude-haiku-4-5-20251001");
    expect(p.id).toBe("anthropic-api");
  });

  it("accepts custom model in constructor", () => {
    const p = new AnthropicApiProvider("key", "claude-opus-4-6");
    expect(p.model).toBe("claude-opus-4-6");
  });
});

describe("ClaudeCodeProvider", () => {
  it("stores model and uses default when unspecified", () => {
    const p = new ClaudeCodeProvider();
    expect(p.model).toBe("claude-haiku-4-5-20251001");
    expect(p.id).toBe("claude-code");
  });

  it("accepts custom model in constructor", () => {
    const p = new ClaudeCodeProvider("claude-sonnet-4-6");
    expect(p.model).toBe("claude-sonnet-4-6");
  });
});

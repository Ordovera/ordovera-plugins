import { describe, it, expect } from "vitest";
import { parsePluginKey, resolveRepo } from "./reader.js";
import type { KnownMarketplacesFile } from "./types.js";

const mockMarketplaces: KnownMarketplacesFile = {
  "claude-plugins-official": {
    source: { source: "github", repo: "anthropics/claude-plugins-official" },
    installLocation: "/tmp/marketplaces/claude-plugins-official",
    lastUpdated: "2026-03-16T00:00:00.000Z",
  },
  "ordovera-plugins": {
    source: { source: "github", repo: "ordovera/ordovera-plugins" },
    installLocation: "/tmp/marketplaces/ordovera-plugins",
    lastUpdated: "2026-04-02T00:00:00.000Z",
  },
};

describe("parsePluginKey", () => {
  it("splits plugin name and marketplace", () => {
    const result = parsePluginKey("context-setup@ordovera-plugins");
    expect(result.pluginName).toBe("context-setup");
    expect(result.marketplace).toBe("ordovera-plugins");
  });

  it("handles official plugins", () => {
    const result = parsePluginKey("atlassian@claude-plugins-official");
    expect(result.pluginName).toBe("atlassian");
    expect(result.marketplace).toBe("claude-plugins-official");
  });

  it("handles keys without @", () => {
    const result = parsePluginKey("standalone-plugin");
    expect(result.pluginName).toBe("standalone-plugin");
    expect(result.marketplace).toBe("");
  });

  it("handles multiple @ signs (uses last)", () => {
    const result = parsePluginKey("my@weird@name@marketplace");
    expect(result.pluginName).toBe("my@weird@name");
    expect(result.marketplace).toBe("marketplace");
  });
});

describe("resolveRepo", () => {
  it("resolves known marketplace to repo", () => {
    const result = resolveRepo("context-setup@ordovera-plugins", mockMarketplaces);
    expect(result).not.toBeNull();
    expect(result!.repo).toBe("ordovera/ordovera-plugins");
    expect(result!.marketplace).toBe("ordovera-plugins");
  });

  it("resolves official marketplace", () => {
    const result = resolveRepo("atlassian@claude-plugins-official", mockMarketplaces);
    expect(result).not.toBeNull();
    expect(result!.repo).toBe("anthropics/claude-plugins-official");
  });

  it("returns null for unknown marketplace", () => {
    const result = resolveRepo("plugin@unknown-marketplace", mockMarketplaces);
    expect(result).toBeNull();
  });

  it("returns null for keys without @", () => {
    const result = resolveRepo("standalone-plugin", mockMarketplaces);
    expect(result).toBeNull();
  });
});

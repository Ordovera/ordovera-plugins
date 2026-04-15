/**
 * Reads Claude Code plugin metadata from disk.
 *
 * Sources:
 * - ~/.claude/plugins/installed_plugins.json -- plugin install records
 * - ~/.claude/plugins/known_marketplaces.json -- marketplace -> GitHub repo map
 * - ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/ -- cached plugin content
 *
 * This module is a clean extraction target for packages/shared/ when
 * cc-session-audit also needs settings reading.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  CachedPluginJson,
  InstalledPluginsFile,
  KnownMarketplacesFile,
  PluginInstall,
} from "./types.js";

const PLUGINS_DIR = join(homedir(), ".claude", "plugins");

export async function readInstalledPlugins(): Promise<InstalledPluginsFile | null> {
  const path = join(PLUGINS_DIR, "installed_plugins.json");
  return readJsonFile<InstalledPluginsFile>(path);
}

export async function readKnownMarketplaces(): Promise<KnownMarketplacesFile | null> {
  const path = join(PLUGINS_DIR, "known_marketplaces.json");
  return readJsonFile<KnownMarketplacesFile>(path);
}

export async function readCachedPluginJson(
  installPath: string
): Promise<CachedPluginJson | null> {
  const pluginJsonPath = join(installPath, ".claude-plugin", "plugin.json");
  return readJsonFile<CachedPluginJson>(pluginJsonPath);
}

export async function listCachedSkills(
  installPath: string
): Promise<string[]> {
  const skillsDir = join(installPath, "skills");
  if (!existsSync(skillsDir)) return [];
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

export async function listCachedHookFiles(
  installPath: string
): Promise<string[]> {
  const hooksDir = join(installPath, "hooks");
  if (!existsSync(hooksDir)) return [];
  try {
    const entries = await readdir(hooksDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export function resolveRepo(
  pluginKey: string,
  marketplaces: KnownMarketplacesFile
): { marketplace: string; repo: string } | null {
  // Plugin keys are "pluginName@marketplaceName"
  const atIndex = pluginKey.lastIndexOf("@");
  if (atIndex === -1) return null;

  const marketplaceName = pluginKey.slice(atIndex + 1);
  const entry = marketplaces[marketplaceName];
  if (!entry?.source?.repo) return null;

  return {
    marketplace: marketplaceName,
    repo: entry.source.repo,
  };
}

export function parsePluginKey(pluginKey: string): {
  pluginName: string;
  marketplace: string;
} {
  const atIndex = pluginKey.lastIndexOf("@");
  if (atIndex === -1) {
    return { pluginName: pluginKey, marketplace: "" };
  }
  return {
    pluginName: pluginKey.slice(0, atIndex),
    marketplace: pluginKey.slice(atIndex + 1),
  };
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

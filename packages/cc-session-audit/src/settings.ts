/**
 * Claude Code settings reader.
 *
 * Reads ~/.claude/settings.json and project-level .claude/settings.json
 * to extract MCP server configs, hook definitions, and plugin metadata.
 *
 * This module is a clean extraction target for packages/shared/ when a
 * second consumer (plugin-verify) needs it.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ClaudeSettings {
  hooks?: {
    preToolUse?: HookDefinition[];
    postToolUse?: HookDefinition[];
    [key: string]: HookDefinition[] | undefined;
  };
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

export interface HookDefinition {
  matcher?: string;
  hooks?: Array<{
    type: string;
    command: string;
  }>;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  [key: string]: unknown;
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

export async function readUserSettings(): Promise<ClaudeSettings | null> {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  return readJsonFile<ClaudeSettings>(settingsPath);
}

export async function readProjectSettings(
  projectDir: string
): Promise<ClaudeSettings | null> {
  const settingsPath = join(projectDir, ".claude", "settings.json");
  return readJsonFile<ClaudeSettings>(settingsPath);
}

export interface McpConfig {
  servers?: Record<string, McpServerConfig>;
}

export async function readMcpConfig(
  projectDir: string
): Promise<McpConfig | null> {
  const mcpPath = join(projectDir, ".mcp.json");
  return readJsonFile<McpConfig>(mcpPath);
}

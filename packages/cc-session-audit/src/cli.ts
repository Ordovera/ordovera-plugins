#!/usr/bin/env node

/**
 * session-audit CLI
 *
 * Usage:
 *   npx @ordovera/session-audit <session.jsonl> [--policy policy.json] [--json]
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseSessionFile } from "./parser.js";
import { analyzeSession } from "./analyzer.js";
import { formatTerminal } from "./formatter.js";
import type { PolicyFile, SessionMessage } from "./types.js";

function printUsage(): void {
  console.log(`Usage: session-audit <session.jsonl> [options]

Analyze a Claude Code session for governance compliance.

Arguments:
  session.jsonl          Path to a Claude Code session JSONL file

Options:
  --policy <file>        Policy file (JSON) defining approved tools, MCP servers,
                         restricted paths, and max autonomous turns
  --json                 Output structured JSON instead of terminal summary
  --help                 Show this help message

Examples:
  session-audit ~/.claude/projects/my-project/abc123.jsonl
  session-audit session.jsonl --policy policy.json
  session-audit session.jsonl --json | jq '.policy_violations'`);
}

async function loadPolicy(path: string): Promise<PolicyFile> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as PolicyFile;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.length === 0) {
    printUsage();
    process.exit(args.includes("--help") ? 0 : 1);
  }

  const jsonOutput = args.includes("--json");
  const policyIndex = args.indexOf("--policy");

  // Extract positional arg (session file)
  const positionalArgs = args.filter(
    (a, i) => !a.startsWith("--") && (policyIndex === -1 || i !== policyIndex + 1)
  );

  if (positionalArgs.length === 0) {
    console.error("Error: session JSONL file path required");
    process.exit(1);
  }

  const sessionPath = resolve(positionalArgs[0]);
  if (!existsSync(sessionPath)) {
    console.error(`Error: file not found: ${sessionPath}`);
    process.exit(1);
  }

  // Load policy if provided
  let policy: PolicyFile | undefined;
  if (policyIndex !== -1) {
    const policyPath = args[policyIndex + 1];
    if (!policyPath) {
      console.error("Error: --policy requires a file path");
      process.exit(1);
    }
    const resolvedPolicy = resolve(policyPath);
    if (!existsSync(resolvedPolicy)) {
      console.error(`Error: policy file not found: ${resolvedPolicy}`);
      process.exit(1);
    }
    try {
      policy = await loadPolicy(resolvedPolicy);
    } catch (e) {
      console.error(`Error: failed to parse policy file: ${e}`);
      process.exit(1);
    }
  }

  // Parse session
  const messages: SessionMessage[] = [];
  for await (const msg of parseSessionFile(sessionPath)) {
    messages.push(msg);
  }

  if (messages.length === 0) {
    console.error("Error: no valid messages found in session file");
    process.exit(1);
  }

  // Analyze
  const report = analyzeSession(messages, sessionPath, policy);

  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTerminal(report));
  }
}

main().catch((e) => {
  console.error(`Error: ${e}`);
  process.exit(1);
});

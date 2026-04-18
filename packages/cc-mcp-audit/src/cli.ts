#!/usr/bin/env node

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServerInput, ServerReport } from "./types.js";
import { analyzeServer, analyzeServers } from "./analyze.js";
import { formatMarkdown } from "./report.js";
import { discover } from "./discover.js";
import { resolveSource } from "./clone.js";
import { screenServer } from "./screen.js";
import { selectProvider } from "./screen-providers.js";
import { toEvidence, toEvidenceBatch } from "./evidence.js";

const subcommand = process.argv[2];

if (subcommand === "discover") {
  runDiscover();
} else {
  runAnalyze().catch((err) => {
    console.error(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

function runDiscover(): void {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      output: { type: "string", short: "o" },
      "min-stars": { type: "string", default: "10" },
      "updated-after": { type: "string" },
      language: { type: "string", multiple: true },
      exclude: { type: "string", multiple: true },
      "github-token": { type: "string" },
      "curated-list": { type: "string", multiple: true },
      "skip-github": { type: "boolean", default: false },
      "skip-curated": { type: "boolean", default: false },
      existing: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`cc-mcp-audit discover -- Find MCP server candidates

Usage:
  cc-mcp-audit discover [options]

Options:
  -o, --output <file>          Write candidates to file (default: stdout)
  --min-stars <n>              Minimum GitHub stars (default: 10)
  --updated-after <date>       Only repos pushed after this ISO date
  --language <lang>            Filter by language (repeatable)
  --exclude <pattern>          Exclude repos matching pattern (repeatable)
  --github-token <token>       GitHub API token (higher rate limits, enrichment)
  --curated-list <url>         Custom curated list URL (repeatable, replaces defaults)
  --skip-github                Skip GitHub search, only parse curated lists
  --skip-curated               Skip curated lists, only GitHub search
  --existing <file>            Existing candidates file for deduplication
  -h, --help                   Show this help

Environment:
  GITHUB_TOKEN                 Alternative to --github-token flag

Examples:
  cc-mcp-audit discover --min-stars 50 -o candidates.json
  cc-mcp-audit discover --language TypeScript --language Python
  cc-mcp-audit discover --skip-github --curated-list https://raw.githubusercontent.com/.../README.md
  cc-mcp-audit discover --existing previous.json -o updated.json`);
    process.exit(0);
  }

  const token = values["github-token"] ?? process.env.GITHUB_TOKEN;

  discover(
    {
      minStars: parseInt(values["min-stars"] ?? "10", 10),
      updatedAfter: values["updated-after"],
      languages: values.language as string[] | undefined,
      exclude: values.exclude as string[] | undefined,
    },
    {
      githubToken: token,
      curatedLists: values["curated-list"] as string[] | undefined,
      skipGitHubSearch: values["skip-github"] as boolean,
      skipCuratedLists: values["skip-curated"] as boolean,
      existingCandidates: values.existing,
    }
  ).then((result) => {
    const output = JSON.stringify(result, null, 2);
    if (values.output) {
      writeFileSync(resolve(values.output), output, "utf-8");
      console.error(
        `Discovered ${result.candidates.length} candidates, written to ${values.output}`
      );
    } else {
      console.log(output);
    }
  }).catch((err) => {
    console.error(`Discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

async function runAnalyze(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      format: { type: "string", short: "f", default: "json" },
      candidates: { type: "string", short: "c" },
      "llm-screen": { type: "boolean", default: false },
      "llm-provider": { type: "string", default: "auto" },
      "llm-model": { type: "string", default: "claude-haiku-4-5-20251001" },
      "llm-budget": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || (positionals.length === 0 && !values.candidates)) {
    console.log(`cc-mcp-audit -- Static analysis for MCP server governance

Usage:
  cc-mcp-audit <repo-url-or-path> [...]    Analyze one or more servers
  cc-mcp-audit -c candidates.json          Analyze servers from a candidates file
  cc-mcp-audit discover [options]           Find MCP server candidates

Options:
  -o, --output <file>       Write report to file (default: stdout)
  -f, --format <fmt>        Output format: json | markdown | evidence (default: json)
  -c, --candidates <file>   JSON file with array of {source, name?} entries
  --llm-screen              Enable LLM triage hints for Domain 5 indicators
  --llm-provider <id>       claude-code | anthropic-api | auto (default: auto)
  --llm-model <id>          Model to use (default: claude-haiku-4-5-20251001)
  --llm-budget <usd>        Abort further LLM calls if cost exceeds this
  -h, --help                Show this help

LLM screening produces triage hints for Domain 5 indicators
(self-modification prevention, sub-agent authority, permission boundaries).
Hints are stored in ServerReport.screeningSignals and are NEVER treated as
coding values -- Domain 5 indicator values remain null until a human fills
them in during review.

Provider behavior:
  auto           Use Claude Code CLI if on PATH, else ANTHROPIC_API_KEY
  claude-code    Use Claude Code CLI (inherits subscription auth)
  anthropic-api  Use direct API (requires ANTHROPIC_API_KEY env var)

Run 'cc-mcp-audit discover --help' for discovery options.

Examples:
  cc-mcp-audit https://github.com/crystaldba/postgres-mcp
  cc-mcp-audit ./local-server-repo --format markdown
  cc-mcp-audit -c servers.json -o report.json
  cc-mcp-audit -c servers.json --llm-screen -o report.json
  cc-mcp-audit discover --min-stars 50 -o candidates.json`);
    process.exit(0);
  }

  let inputs: McpServerInput[];

  if (values.candidates) {
    const raw = readFileSync(resolve(values.candidates), "utf-8");
    const parsed = JSON.parse(raw);
    // Support both raw array and CandidateFile format
    inputs = Array.isArray(parsed) ? parsed : parsed.candidates;
  } else {
    inputs = positionals.map((source) => ({ source }));
  }

  const singleReport = inputs.length === 1 ? buildSingleReport(inputs[0]) : null;
  const multiReport = inputs.length > 1 ? analyzeServers(inputs) : null;

  const serverReports: ServerReport[] = multiReport
    ? multiReport.servers
    : singleReport
      ? [singleReport]
      : [];

  // Optional LLM screening pass for Domain 5 indicators
  if (values["llm-screen"]) {
    const provider = selectProvider(
      values["llm-provider"] as "claude-code" | "anthropic-api" | "auto",
      values["llm-model"] ?? "claude-haiku-4-5-20251001"
    );
    const budgetUsd = values["llm-budget"]
      ? parseFloat(values["llm-budget"])
      : undefined;

    console.error(
      `Running LLM screening pass (${provider.id}, model=${provider.model})...`
    );

    for (const [idx, server] of serverReports.entries()) {
      const { localPath } = resolveSource(server.source);
      try {
        const screenResult = await screenServer(localPath, {
          provider,
          budgetUsd,
        });
        server.screeningSignals = screenResult.signals;
        server.screeningMetadata = screenResult.metadata;
        console.error(
          `  [${idx + 1}/${serverReports.length}] ${server.name}: screened`
        );
      } catch (err) {
        console.error(
          `  [${idx + 1}/${serverReports.length}] ${server.name}: screening failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  const report = multiReport ?? {
    ...singleReport!,
    schemaVersion: "0.1.0" as const,
  };

  let output: string;
  if (values.format === "evidence") {
    if (multiReport) {
      output = JSON.stringify(toEvidenceBatch(multiReport), null, 2);
    } else {
      output = JSON.stringify(toEvidence(singleReport!), null, 2);
    }
  } else if (values.format === "markdown") {
    output = formatMarkdown(
      "servers" in report
        ? report
        : {
            generatedAt: new Date().toISOString(),
            schemaVersion: "0.1.0",
            servers: [report as any],
            summary: {
              totalServers: 1,
              totalTools: (report as any).tools?.length ?? 0,
              totalSensitiveTools: (report as any).sensitiveToolCount ?? 0,
              serversWithAuth: (report as any).flags?.hasAuth ? 1 : 0,
              serversWithLogging: (report as any).flags?.hasLogging ? 1 : 0,
              serversWithGates: (report as any).flags?.hasConfirmationGates
                ? 1
                : 0,
            },
          }
    );
  } else {
    output = JSON.stringify(report, null, 2);
  }

  if (values.output) {
    writeFileSync(resolve(values.output), output, "utf-8");
    console.error(`Report written to ${values.output}`);
  } else {
    console.log(output);
  }
}

function buildSingleReport(input: McpServerInput) {
  return analyzeServer(input);
}

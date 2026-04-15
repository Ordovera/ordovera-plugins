#!/usr/bin/env node

/**
 * cc-sc-verify CLI
 *
 * Usage:
 *   npx cc-sc-verify [--marketplace <name>] [--plugin <key>] [--json]
 */

import { verifyPlugins } from "./verifier.js";
import { formatTerminal } from "./formatter.js";

function printUsage(): void {
  console.log(`Usage: cc-sc-verify [options]

Verify Claude Code plugins against their source repos for supply chain integrity.

Reads installed plugin metadata from ~/.claude/plugins/ automatically.

Options:
  --marketplace <name>   Only check plugins from this marketplace
  --plugin <key>         Only check a specific plugin (e.g., "context-setup@ordovera-plugins")
  --quick                Skip deep analysis (permissions, integrity, deps)
  --audit-deps           Check bundled dependencies against OSV for CVEs and deprecation
  --json                 Output structured JSON instead of terminal summary
  --help                 Show this help message

Environment:
  GITHUB_TOKEN           GitHub token for authenticated API access (5,000 req/hr vs 60 req/hr)

Examples:
  cc-sc-verify
  cc-sc-verify --marketplace ordovera-plugins
  cc-sc-verify --plugin context-setup@ordovera-plugins --json
  GITHUB_TOKEN=ghp_xxx cc-sc-verify`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help")) {
    printUsage();
    process.exit(0);
  }

  const jsonOutput = args.includes("--json");

  const marketplaceIndex = args.indexOf("--marketplace");
  const marketplace =
    marketplaceIndex !== -1 ? args[marketplaceIndex + 1] : undefined;

  const pluginIndex = args.indexOf("--plugin");
  const plugin = pluginIndex !== -1 ? args[pluginIndex + 1] : undefined;

  if (!process.env.GITHUB_TOKEN) {
    if (!jsonOutput) {
      console.log(
        "Note: No GITHUB_TOKEN set. Using unauthenticated API (60 req/hr limit).\n" +
        "Set GITHUB_TOKEN for 5,000 req/hr.\n"
      );
    }
  }

  const deep = !args.includes("--quick");
  const auditDeps = args.includes("--audit-deps");
  const report = await verifyPlugins({ marketplace, plugin, deep, auditDeps });

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTerminal(report));
  }

  // Exit with non-zero if issues found
  if (report.plugins_with_issues > 0 || report.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`Error: ${e}`);
  process.exit(1);
});

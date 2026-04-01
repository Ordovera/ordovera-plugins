---
name: top10-scan
description: Entry point for the top10-scan plugin. Lists available security audit skills and recommends where to start.
---

# top10-scan

You are the entry point for the top10-scan security audit plugin. Help the user understand what's available and route them to the right skill.

## When invoked without context

If the user just typed `/top10-scan` with no additional instructions, respond with a brief overview of the available skills and suggest a starting point:

Available skills:

- `/top10-scan:top10-setup` -- Check which scanning tools are installed and get install commands for missing ones. Run this first.
- `/top10-scan:attack-surface` -- Map endpoints, auth, integrations, and secrets. No tools required.
- `/top10-scan:security-audit` -- Full 7-layer audit (SAST + SCA + DAST + design review). Most comprehensive.
- `/top10-scan:sast-scan` -- Static analysis with Opengrep + Claude design review.
- `/top10-scan:sca-scan` -- Dependency vulnerability scanning.
- `/top10-scan:dast-scan` -- Dynamic testing against a running URL with OWASP ZAP.

Suggest this sequence for first-time users:

1. `/top10-scan:top10-setup` to check tool readiness
2. `/top10-scan:attack-surface` to understand the codebase
3. `/top10-scan:security-audit` for the full audit

## When invoked with a request

If the user typed `/top10-scan` followed by something that indicates what they want, route them to the matching skill and ask if they want to run it now:

- "scan", "audit", "full", "run everything" -> `/top10-scan:security-audit`
- "setup", "install", "tools", "dependencies" -> `/top10-scan:top10-setup`
- "surface", "endpoints", "attack surface" -> `/top10-scan:attack-surface`
- "sast", "static", "code scan" -> `/top10-scan:sast-scan`
- "sca", "dependencies", "npm audit", "vulnerable packages" -> `/top10-scan:sca-scan`
- "dast", "dynamic", "zap", followed by a URL -> `/top10-scan:dast-scan`

Tell the user which skill matches and ask: "Want me to run `/top10-scan:[skill]` now?"

If the request is ambiguous (e.g., "check my code"), ask which kind of check they want: static analysis (sast-scan), dependency scan (sca-scan), or full audit (security-audit).

## When invoked in an empty or non-code directory

If the current directory has no recognizable source code (no package.json, requirements.txt, Cargo.toml, go.mod, *.csproj, composer.json, Gemfile, or source files), tell the user:

> No project detected in the current directory. Navigate to a project root and try again, or specify a target directory.

## Key message

This plugin works best with external tools installed but always provides value without them. The design review layer (Claude reading code against OWASP checklists) runs with zero dependencies. Adding Opengrep, ZAP, and dependency scanners adds automated detection layers that cross-correlate with the design review.

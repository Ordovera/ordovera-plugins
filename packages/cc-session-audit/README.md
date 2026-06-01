# cc-session-audit

Compliance analyzer for Claude Code sessions. Forensic analysis of a session's tool use, MCP servers, autonomous behavior, and policy violations -- from the session's own JSONL transcript.

## Install

```bash
npx cc-session-audit <session.jsonl>
```

Claude Code session transcripts live under `~/.claude/projects/<project>/<session-id>.jsonl`.

## What it does

Parses a Claude Code session JSONL file and reports, without sending anything off your machine:

- **Message counts** -- human turns, assistant turns, tool uses, tool results, progress and system events
- **Interaction ratio** -- human turns vs. autonomous assistant turns (a quick read on how hands-off the session ran)
- **Tool inventory** -- every tool invoked, with counts and type (built-in vs. MCP)
- **MCP servers active** -- which MCP servers the session actually called
- **File modifications** -- writes/edits the session performed
- **Policy violations** -- deviations from an optional policy file (denied tools/servers, restricted paths, autonomy budget)
- **Compaction events** -- how many times the session's context was compacted

## Usage

```bash
# Audit a session (terminal summary)
cc-session-audit ~/.claude/projects/my-project/abc123.jsonl

# Audit against a governance policy
cc-session-audit session.jsonl --policy policy.json

# JSON output, piped to jq
cc-session-audit session.jsonl --json | jq '.policy_violations'
```

## Example output

```
Session Audit Report
====================
Session: test-session-2
File: /path/to/session.jsonl
Time range: 2026-04-15T10:00:00.000Z to 2026-04-15T10:00:30.000Z

Message Counts
--------------
  Human turns:     1
  Assistant turns:  4
  Tool uses:        3
  Tool results:     3
  Progress events:  0
  System events:    0

Interaction Ratio
-----------------
  1:4 (human:autonomous)

Tool Inventory
--------------
  Tool                                                Count  Type
  --------------------------------------------------  -----  ----
  mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql      1  MCP
  mcp__claude_ai_Gmail__gmail_search_messages             1  MCP
  Write                                                   1  built-in
```

## Policy file format

A policy is a JSON file. All fields are optional -- only the ones you set are enforced.

```json
{
  "approved_tools": ["Read", "Grep", "Glob"],
  "denied_tools": ["Bash", "Write"],
  "approved_mcp_servers": ["claude_ai_Atlassian"],
  "denied_mcp_servers": ["claude_ai_Gmail"],
  "restricted_paths": ["/etc/", ".env"],
  "max_autonomous_turns": 20
}
```

| Field | Effect |
|-------|--------|
| `approved_tools` | Any tool used that is **not** in this list is flagged as `unapproved_tool`. |
| `denied_tools` | Any tool used that **is** in this list is flagged as `denied_tool`. |
| `approved_mcp_servers` | MCP servers not in this list are flagged. |
| `denied_mcp_servers` | MCP servers in this list are flagged. |
| `restricted_paths` | File modifications touching these paths are flagged. |
| `max_autonomous_turns` | Flags runs whose consecutive autonomous turns exceed this budget. |

## JSON output

`--json` emits the full `AuditReport`:

```
session_file, session_id, timestamp_range, message_counts,
tool_inventory, mcp_servers, interaction_ratio,
file_modifications, policy_violations, compaction_events
```

Each entry in `policy_violations` carries a `rule`, a human-readable `detail`, a `timestamp`, and the offending `tool` or path.

## How it works

1. Reads the session JSONL line by line (malformed lines are skipped, not fatal).
2. Walks the message stream to tally turns, tool calls, tool results, and compaction events.
3. Classifies each tool as built-in or MCP (MCP tools carry the `mcp__<server>__<tool>` prefix) and extracts the active server set.
4. Derives the human:autonomous interaction ratio and the list of file modifications.
5. If a policy file is supplied, evaluates each rule and emits structured violations.

All analysis is local; the session file never leaves your machine.

## Sibling packages and plugins

- [cc-mcp-audit package](../cc-mcp-audit/) -- governance posture CLI for MCP servers
- [cc-sc-verify package](../cc-sc-verify/) -- supply chain integrity checker for Claude Code plugins
- [mcp-audit plugin](../../plugins/mcp-audit/) -- interpretive MCP governance analysis
- [context-setup plugin](../../plugins/context-setup/) -- context engineering and trust boundary documentation
- [top10-scan plugin](../../plugins/top10-scan/) -- OWASP Top 10 security scanning

## License

MIT

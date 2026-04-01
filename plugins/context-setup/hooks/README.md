# Hooks

Working hook implementations for the three-layer defense model described in context-upgrade.

## Three-Layer Defense

1. **AGENTS.md (declarative)** -- Says what to do and not do. Advisory. Agents read it and follow guidance voluntarily.
2. **Hooks (imperative)** -- Enforce rules at execution time. Blocking. Prevents violations before they happen.
3. **Skills (operational)** -- Validate at planning time and detect drift. Proactive. Catches problems that slipped through.

All three layers read the same AGENTS.md files. The context file is the single source of truth; hooks and skills are the enforcement layer.

## Available Hooks

### boundary-guard.py (PreToolUse)

Blocks edits to restricted files. Runs before every file edit operation.

**What it protects:**

- Credential files (*.env, *.key, *.pem, credentials.json, secrets.yaml)
- AGENTS.md from deletion (edits are allowed, delete is not)

**What it allows:**

- All non-file-edit tool calls
- Edits to any file not matching restricted patterns

### lint-context.sh (PostToolUse)

Validates context file formatting after edits. Runs after Write/Edit operations targeting AGENTS.md, CLAUDE.md, or context/*.md.

**What it checks:**

- File starts with a markdown heading
- No trailing whitespace
- File ends with a newline
- CLAUDE.md is a symlink to AGENTS.md (warns if not)

**Behavior:** Always allows the edit but surfaces warnings. Does not block.

### symlink-check.sh (PostToolUse)

Verifies CLAUDE.md symlink integrity after file operations.

**Behavior:**

- Symlink to AGENTS.md: allows silently
- Symlink to something else: warns
- Regular file with "See AGENTS.md" content: warns, suggests symlink
- Regular file with identical content to AGENTS.md: warns, suggests symlink
- Regular file with different content: blocks (CLAUDE.md should not diverge from AGENTS.md)

## Installation

Add to `.claude/settings.json` in your project:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hook": "python3 plugins/context-setup/hooks/boundary-guard.py"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hook": "bash plugins/context-setup/hooks/lint-context.sh"
      },
      {
        "matcher": "Write|Edit|MultiEdit",
        "hook": "bash plugins/context-setup/hooks/symlink-check.sh"
      }
    ]
  }
}
```

Adjust paths based on where the plugin is installed. If installed via the plugin marketplace, use the plugin cache path.

## Customizing Restricted Patterns

Edit the `RESTRICTED_PATTERNS` list in `boundary-guard.py` to add or remove file patterns. The default list covers common credential and secret file patterns.

## Testing

Run the test suite:

```bash
bash plugins/context-setup/hooks/test-hooks.sh
```

This tests each hook with valid and invalid inputs to verify correct allow/block behavior.

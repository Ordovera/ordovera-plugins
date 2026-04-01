#!/usr/bin/env python3
"""Verification for context-setup fixture contracts and golden baselines.

This verifier does not execute Claude skills directly. Instead it validates that:

1. The curated fixtures exist and contain the signals the plugin is expected to detect.
2. The expected-results files are present and structurally complete.
3. The stale-context fixture still contains the drift and audit scenarios we rely on.
4. The scaffold, audit, and align golden baselines remain internally consistent and structurally sound.

This is intentionally lightweight. It protects the scenario contract while we build out
deeper verification over time.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = ROOT / "test-fixtures"
EXPECTED_DIR = ROOT / "expected-results"


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def assert_true(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def normalized_contains(haystack: str, needle: str) -> bool:
    return needle.lower() in haystack.lower()


def verify_scaffold_manifest(fixture_name: str, failures: list[str]) -> None:
    fixture_dir = FIXTURES_DIR / fixture_name
    scaffold_dir = EXPECTED_DIR / fixture_name / "scaffold"
    manifest_path = scaffold_dir / "manifest.json"
    agents_expected_path = scaffold_dir / "AGENTS.md.expected"

    assert_true(manifest_path.is_file(), f"missing scaffold manifest for {fixture_name}", failures)
    assert_true(agents_expected_path.is_file(), f"missing scaffold AGENTS baseline for {fixture_name}", failures)
    if not manifest_path.is_file() or not agents_expected_path.is_file():
        return

    manifest = load_json(manifest_path)
    agents_expected = read_text(agents_expected_path)

    assert_true(manifest.get("fixture") == fixture_name, f"{fixture_name} scaffold manifest fixture mismatch", failures)
    assert_true(manifest.get("skill") == "context-scaffold", f"{fixture_name} scaffold manifest should target context-scaffold", failures)
    assert_true(manifest.get("status") == "golden_baseline", f"{fixture_name} scaffold manifest should be marked golden_baseline", failures)
    assert_true("AGENTS.md" in manifest.get("expected_files", []), f"{fixture_name} scaffold manifest should require AGENTS.md", failures)
    assert_true("CLAUDE.md" in manifest.get("expected_files", []), f"{fixture_name} scaffold manifest should require CLAUDE.md", failures)

    for heading in manifest.get("required_headings", []):
        assert_true(heading in agents_expected, f"{fixture_name} scaffold baseline missing heading: {heading}", failures)

    for snippet in manifest.get("required_substrings", []):
        assert_true(normalized_contains(agents_expected, snippet), f"{fixture_name} scaffold baseline missing required text: {snippet}", failures)

    for snippet in manifest.get("forbidden_substrings", []):
        assert_true(not normalized_contains(agents_expected, snippet), f"{fixture_name} scaffold baseline contains forbidden text: {snippet}", failures)

    # Confirm the fixture still matches the intended recommendation shape.
    if fixture_name == "minimal-node-app":
        pkg = load_json(fixture_dir / "package.json")
        assert_true(manifest.get("recommendation") == "minimal", "minimal-node-app scaffold manifest should recommend minimal", failures)
        assert_true("vitest" in pkg.get("devDependencies", {}), "minimal-node-app scaffold baseline should align with vitest fixture signal", failures)
    elif fixture_name == "fullstack-app":
        pkg = load_json(fixture_dir / "package.json")
        deps = pkg.get("dependencies", {})
        assert_true(manifest.get("recommendation") == "full_single_file", "fullstack-app scaffold manifest should recommend full_single_file", failures)
        assert_true("next" in deps and "next-auth" in deps and "prisma" in deps, "fullstack-app scaffold baseline should align with framework/auth/data signals", failures)
    elif fixture_name == "memory-trust-app":
        mcp = load_json(fixture_dir / ".mcp.json")
        settings = load_json(fixture_dir / ".claude" / "settings.json")
        assert_true(manifest.get("recommendation") == "full_single_file", "memory-trust-app scaffold manifest should recommend full_single_file", failures)
        assert_true(set(mcp.get("servers", {}).keys()) == {"github", "sentry"}, "memory-trust-app scaffold baseline should align with detected MCP servers", failures)
        assert_true(settings["hooks"]["preToolUse"][0]["hooks"][0]["command"] == "python3 scripts/hooks/preflight.py", "memory-trust-app scaffold baseline should align with detected hook command", failures)
        assert_true((fixture_dir / "MEMORY.md").is_file(), "memory-trust-app scaffold baseline should align with existing MEMORY.md signal", failures)


def verify_audit_golden(failures: list[str]) -> None:
    fixture_dir = FIXTURES_DIR / "stale-context-app"
    audit_dir = EXPECTED_DIR / "stale-context-app" / "audit"
    summary_path = audit_dir / "summary.json"
    findings_path = audit_dir / "findings.json"

    assert_true(summary_path.is_file(), "missing audit summary baseline for stale-context-app", failures)
    assert_true(findings_path.is_file(), "missing audit findings baseline for stale-context-app", failures)
    if not summary_path.is_file() or not findings_path.is_file():
        return

    summary = load_json(summary_path)
    findings = load_json(findings_path)
    agents = read_text(fixture_dir / "AGENTS.md")
    sub_agents = read_text(fixture_dir / "src" / "api" / "AGENTS.md")
    arch = read_text(fixture_dir / "context" / "architecture-decisions.md")
    claude = read_text(fixture_dir / "CLAUDE.md")

    assert_true(summary.get("fixture") == "stale-context-app", "audit summary fixture mismatch", failures)
    assert_true(summary.get("skill") == "context-audit", "audit summary should target context-audit", failures)
    assert_true(summary.get("status") == "golden_baseline", "audit summary should be marked golden_baseline", failures)
    assert_true(findings.get("fixture") == "stale-context-app", "audit findings fixture mismatch", failures)
    assert_true(findings.get("skill") == "context-audit", "audit findings should target context-audit", failures)
    assert_true(findings.get("status") == "golden_baseline", "audit findings should be marked golden_baseline", failures)

    statuses = summary.get("expected_category_statuses", {})
    assert_true(statuses.get("Format and Conventions") == "Partial", "audit golden baseline should expect partial format status", failures)
    assert_true(statuses.get("Structural Issues") == "Partial", "audit golden baseline should expect partial structural status", failures)

    required_findings = findings.get("required_findings", [])
    assert_true(any("CLAUDE.md is a regular file instead of a symlink" == item for item in required_findings), "audit golden baseline should include CLAUDE.md symlink finding", failures)
    assert_true(any("npm run test:api" in item for item in required_findings), "audit golden baseline should include stale command finding", failures)
    assert_true(any("src/lib/auth" in item for item in required_findings), "audit golden baseline should include stale auth path finding", failures)
    assert_true(any("Cascading contradiction" in item for item in required_findings), "audit golden baseline should include contradiction finding", failures)

    priority_recommendations = findings.get("priority_recommendations", [])
    assert_true(len(priority_recommendations) >= 3, "audit golden baseline should include three priority recommendations", failures)
    assert_true(any("Fix stale command references" == item for item in priority_recommendations), "audit golden baseline should prioritize stale command cleanup", failures)

    # Cross-check against fixture content.
    assert_true("See `AGENTS.md`." in claude, "stale-context-app CLAUDE.md should still be a regular file for audit coverage", failures)
    assert_true("npm run test:api" in agents and "npm run test:api" in arch, "stale-context-app should still carry stale command references for audit coverage", failures)
    assert_true("src/lib/auth/" in agents, "stale-context-app should still carry stale auth path reference for audit coverage", failures)
    assert_true("Jest" in sub_agents, "stale-context-app should still carry test runner contradiction for audit coverage", failures)


def verify_align_golden(failures: list[str]) -> None:
    fixture_dir = FIXTURES_DIR / "stale-context-app"
    align_dir = EXPECTED_DIR / "stale-context-app" / "align"
    findings_path = align_dir / "findings.json"

    assert_true(findings_path.is_file(), "missing align findings baseline for stale-context-app", failures)
    if not findings_path.is_file():
        return

    findings = load_json(findings_path)
    pkg = load_json(fixture_dir / "package.json")
    agents = read_text(fixture_dir / "AGENTS.md")
    sub_agents = read_text(fixture_dir / "src" / "api" / "AGENTS.md")
    arch = read_text(fixture_dir / "context" / "architecture-decisions.md")

    assert_true(findings.get("fixture") == "stale-context-app", "align findings fixture mismatch", failures)
    assert_true(findings.get("skill") == "context-align", "align findings should target context-align", failures)
    assert_true(findings.get("status") == "golden_baseline", "align findings should be marked golden_baseline", failures)

    required_findings = findings.get("required_findings", [])
    assert_true(any("React 18" in item and "React 19" in item for item in required_findings), "align golden baseline should include stale React version finding", failures)
    assert_true(any("src/lib/auth" in item for item in required_findings), "align golden baseline should include stale auth path finding", failures)
    assert_true(any("architecture-decisions.md" in item and "npm run test:api" in item for item in required_findings), "align golden baseline should include stale architecture command finding", failures)
    assert_true(any("src/api/AGENTS.md" in item and "test runner" in item for item in required_findings), "align golden baseline should include contradiction finding", failures)

    # Cross-check against fixture content.
    assert_true(pkg["dependencies"]["react"].startswith("^19"), "stale-context-app should still depend on React 19 for align coverage", failures)
    assert_true("React 18" in agents, "stale-context-app AGENTS.md should still contain React 18 for align coverage", failures)
    assert_true("src/lib/auth/" in agents, "stale-context-app AGENTS.md should still contain stale auth path for align coverage", failures)
    assert_true("npm run test:api" in arch, "stale-context-app architecture doc should still contain stale command for align coverage", failures)
    assert_true("Jest" in sub_agents, "stale-context-app subdirectory AGENTS should still contradict root guidance for align coverage", failures)


def verify_memory_trust_golden(failures: list[str]) -> None:
    fixture_dir = FIXTURES_DIR / "memory-trust-app"
    audit_dir = EXPECTED_DIR / "memory-trust-app" / "audit"
    align_dir = EXPECTED_DIR / "memory-trust-app" / "align"
    audit_summary_path = audit_dir / "summary.json"
    audit_findings_path = audit_dir / "findings.json"
    align_findings_path = align_dir / "findings.json"

    assert_true(audit_summary_path.is_file(), "missing audit summary baseline for memory-trust-app", failures)
    assert_true(audit_findings_path.is_file(), "missing audit findings baseline for memory-trust-app", failures)
    assert_true(align_findings_path.is_file(), "missing align findings baseline for memory-trust-app", failures)
    if not audit_summary_path.is_file() or not audit_findings_path.is_file() or not align_findings_path.is_file():
        return

    audit_summary = load_json(audit_summary_path)
    audit_findings = load_json(audit_findings_path)
    align_findings = load_json(align_findings_path)
    agents = read_text(fixture_dir / "AGENTS.md")
    memory = read_text(fixture_dir / "MEMORY.md")
    mcp = load_json(fixture_dir / ".mcp.json")
    settings = load_json(fixture_dir / ".claude" / "settings.json")

    assert_true(audit_summary.get("fixture") == "memory-trust-app", "memory-trust-app audit summary fixture mismatch", failures)
    assert_true(audit_summary.get("skill") == "context-audit", "memory-trust-app audit summary should target context-audit", failures)
    assert_true(audit_summary.get("status") == "golden_baseline", "memory-trust-app audit summary should be marked golden_baseline", failures)
    assert_true(audit_findings.get("fixture") == "memory-trust-app", "memory-trust-app audit findings fixture mismatch", failures)
    assert_true(audit_findings.get("skill") == "context-audit", "memory-trust-app audit findings should target context-audit", failures)
    assert_true(audit_findings.get("status") == "golden_baseline", "memory-trust-app audit findings should be marked golden_baseline", failures)
    assert_true(align_findings.get("fixture") == "memory-trust-app", "memory-trust-app align findings fixture mismatch", failures)
    assert_true(align_findings.get("skill") == "context-align", "memory-trust-app align findings should target context-align", failures)
    assert_true(align_findings.get("status") == "golden_baseline", "memory-trust-app align findings should be marked golden_baseline", failures)

    statuses = audit_summary.get("expected_category_statuses", {})
    assert_true(statuses.get("Trust Boundary Coverage") == "Partial", "memory-trust-app should expect partial trust-boundary coverage", failures)
    assert_true(statuses.get("Structural Issues") == "Partial", "memory-trust-app should expect partial structural status", failures)

    required_audit_findings = audit_findings.get("required_findings", [])
    assert_true(any("volatile workflow notes" in item for item in required_audit_findings), "memory-trust-app audit baseline should include overloaded root guidance finding", failures)
    assert_true(any("operator-owned trust boundaries" in item for item in required_audit_findings), "memory-trust-app audit baseline should include trust-boundary finding", failures)
    assert_true(any("MEMORY.md mostly duplicates durable project policy" in item for item in required_audit_findings), "memory-trust-app audit baseline should include MEMORY.md misuse finding", failures)

    required_align_findings = align_findings.get("required_findings", [])
    assert_true(any("GitHub and Linear" in item and "GitHub and Sentry" in item for item in required_align_findings), "memory-trust-app align baseline should include MCP drift finding", failures)
    assert_true(any(".claude/hooks/preflight.py" in item and "scripts/hooks/preflight.py" in item for item in required_align_findings), "memory-trust-app align baseline should include hook path drift finding", failures)
    assert_true(any("context/session-memory.md" in item for item in required_align_findings), "memory-trust-app align baseline should include MEMORY.md stale reference finding", failures)

    configured_servers = set(mcp.get("servers", {}).keys())
    hook_command = settings["hooks"]["preToolUse"][0]["hooks"][0]["command"]
    assert_true(configured_servers == {"github", "sentry"}, "memory-trust-app fixture should still configure GitHub and Sentry MCP servers", failures)
    assert_true("Configured MCP servers: GitHub, Linear" in agents, "memory-trust-app AGENTS.md should still carry stale MCP server references", failures)
    assert_true(".claude/hooks/preflight.py" in agents, "memory-trust-app AGENTS.md should still carry stale hook path reference", failures)
    assert_true("Agents may update hook configuration when improving local workflows" in agents, "memory-trust-app AGENTS.md should still imply overly broad hook-editing authority", failures)
    assert_true("Current migration focus" in agents and "running issue log" in agents, "memory-trust-app AGENTS.md should still carry volatile root notes", failures)
    assert_true("Configured MCP servers: GitHub, Linear" in memory, "memory-trust-app MEMORY.md should still duplicate durable policy for audit coverage", failures)
    assert_true("context/session-memory.md" in memory, "memory-trust-app MEMORY.md should still reference a missing file", failures)
    assert_true(hook_command == "python3 scripts/hooks/preflight.py", "memory-trust-app settings should still point to scripts/hooks/preflight.py", failures)
    assert_true((fixture_dir / "scripts" / "hooks" / "preflight.py").is_file(), "memory-trust-app should still include the actual preflight hook script", failures)


def verify_upgrade_golden(failures: list[str]) -> None:
    fixture_dir = FIXTURES_DIR / "memory-trust-app"
    plan_path = EXPECTED_DIR / "memory-trust-app" / "upgrade" / "plan.json"

    assert_true(plan_path.is_file(), "missing upgrade plan baseline for memory-trust-app", failures)
    if not plan_path.is_file():
        return

    plan = load_json(plan_path)
    agents = read_text(fixture_dir / "AGENTS.md")
    memory = read_text(fixture_dir / "MEMORY.md")

    assert_true(plan.get("fixture") == "memory-trust-app", "memory-trust-app upgrade plan fixture mismatch", failures)
    assert_true(plan.get("skill") == "context-upgrade", "memory-trust-app upgrade plan should target context-upgrade", failures)
    assert_true(plan.get("status") == "golden_baseline", "memory-trust-app upgrade plan should be marked golden_baseline", failures)
    assert_true(plan.get("current_level") == "full_single_file", "memory-trust-app upgrade baseline should start from full_single_file", failures)
    assert_true(plan.get("recommended_upgrade") == "cascading_with_context_directory", "memory-trust-app upgrade baseline should recommend cascading_with_context_directory", failures)

    required_actions = plan.get("required_actions", [])
    assert_true(any("durable root entrypoint" in item for item in required_actions), "upgrade baseline should include root-entrypoint action", failures)
    assert_true(any("context/operational-boundaries.md" in item for item in required_actions), "upgrade baseline should include operational-boundaries action", failures)
    assert_true(any("Move volatile migration or troubleshooting notes" in item for item in required_actions), "upgrade baseline should include volatile-root cleanup action", failures)
    assert_true(any("Keep MEMORY.md only as short-lived working memory" in item for item in required_actions), "upgrade baseline should include MEMORY.md reconciliation action", failures)

    required_signals = plan.get("required_signals", [])
    assert_true("MCP config present" in required_signals, "upgrade baseline should include MCP config signal", failures)
    assert_true("Claude hook settings present" in required_signals, "upgrade baseline should include hook settings signal", failures)
    assert_true("MEMORY.md present" in required_signals, "upgrade baseline should include MEMORY.md signal", failures)
    assert_true("Root context contains volatile workflow notes" in required_signals, "upgrade baseline should include volatile-root signal", failures)

    assert_true("Configured MCP servers: GitHub, Linear" in agents, "memory-trust-app AGENTS.md should still carry trust-surface material for upgrade coverage", failures)
    assert_true("Current migration focus" in agents and "running issue log" in agents, "memory-trust-app AGENTS.md should still carry volatile root notes for upgrade coverage", failures)
    assert_true("Configured MCP servers: GitHub, Linear" in memory, "memory-trust-app MEMORY.md should still exist for upgrade coverage", failures)


def verify_minimal(failures: list[str]) -> None:
    fixture = FIXTURES_DIR / "minimal-node-app"
    pkg = load_json(fixture / "package.json")

    assert_true("vitest" in pkg.get("devDependencies", {}), "minimal-node-app should include vitest for command detection", failures)
    assert_true(not (fixture / "prisma").exists(), "minimal-node-app should not include a database schema", failures)
    assert_true(not (fixture / "app" / "api").exists(), "minimal-node-app should not include API route structure", failures)
    assert_true("eslint" in pkg.get("devDependencies", {}), "minimal-node-app should expose lint command signals", failures)


def verify_fullstack(failures: list[str]) -> None:
    fixture = FIXTURES_DIR / "fullstack-app"
    pkg = load_json(fixture / "package.json")

    deps = pkg.get("dependencies", {})
    assert_true("next" in deps, "fullstack-app should expose nextjs framework markers", failures)
    assert_true("next-auth" in deps, "fullstack-app should expose auth package markers", failures)
    assert_true((fixture / "prisma" / "schema.prisma").is_file(), "fullstack-app should include prisma schema", failures)
    assert_true((fixture / "app" / "api" / "users" / "route.ts").is_file(), "fullstack-app should include API route structure", failures)
    assert_true(not (fixture / "context").exists(), "fullstack-app should remain a clean scaffold fixture without pre-existing context files", failures)


def verify_stale(failures: list[str]) -> None:
    fixture = FIXTURES_DIR / "stale-context-app"
    pkg = load_json(fixture / "package.json")
    agents = read_text(fixture / "AGENTS.md")
    sub_agents = read_text(fixture / "src" / "api" / "AGENTS.md")
    arch = read_text(fixture / "context" / "architecture-decisions.md")

    assert_true(pkg["dependencies"]["react"].startswith("^19"), "stale-context-app should currently depend on React 19", failures)
    assert_true("React 18" in agents, "stale-context-app AGENTS.md should contain a stale React 18 reference", failures)
    assert_true("npm run test:api" in agents, "stale-context-app AGENTS.md should contain a stale test command", failures)
    assert_true("src/lib/auth/" in agents, "stale-context-app AGENTS.md should contain a stale auth path", failures)
    assert_true(not (fixture / "src" / "lib" / "auth").exists(), "stale-context-app should not have src/lib/auth", failures)
    assert_true((fixture / "src" / "middleware" / "auth.ts").is_file(), "stale-context-app should use src/middleware/auth.ts", failures)
    assert_true("Jest" in sub_agents, "stale-context-app subdirectory AGENTS should contradict the root test runner", failures)
    assert_true("npm run test:api" in arch, "stale-context-app architecture doc should contain a stale command reference", failures)
    assert_true((fixture / "CLAUDE.md").is_file(), "stale-context-app should include a plain CLAUDE.md file", failures)


def verify_memory_trust(failures: list[str]) -> None:
    fixture = FIXTURES_DIR / "memory-trust-app"
    pkg = load_json(fixture / "package.json")
    agents = read_text(fixture / "AGENTS.md")
    memory = read_text(fixture / "MEMORY.md")
    mcp = load_json(fixture / ".mcp.json")
    settings = load_json(fixture / ".claude" / "settings.json")

    assert_true(pkg["dependencies"]["react"].startswith("^19"), "memory-trust-app should currently depend on React 19", failures)
    assert_true((fixture / ".mcp.json").is_file(), "memory-trust-app should include MCP config", failures)
    assert_true((fixture / ".claude" / "settings.json").is_file(), "memory-trust-app should include Claude hook settings", failures)
    assert_true((fixture / "scripts" / "hooks" / "preflight.py").is_file(), "memory-trust-app should include a hook script", failures)
    assert_true((fixture / "MEMORY.md").is_file(), "memory-trust-app should include MEMORY.md for optional-support coverage", failures)
    assert_true("Configured MCP servers: GitHub, Linear" in agents, "memory-trust-app AGENTS.md should contain stale MCP server references", failures)
    assert_true(".claude/hooks/preflight.py" in agents, "memory-trust-app AGENTS.md should contain stale hook path reference", failures)
    assert_true("Current migration focus" in agents, "memory-trust-app AGENTS.md should include volatile root notes", failures)
    assert_true("Configured MCP servers: GitHub, Linear" in memory, "memory-trust-app MEMORY.md should duplicate durable project policy", failures)
    assert_true("context/session-memory.md" in memory, "memory-trust-app MEMORY.md should reference a missing session-memory file", failures)
    assert_true(set(mcp.get("servers", {}).keys()) == {"github", "sentry"}, "memory-trust-app MCP config should expose GitHub and Sentry server markers", failures)
    assert_true(settings["hooks"]["preToolUse"][0]["hooks"][0]["command"] == "python3 scripts/hooks/preflight.py", "memory-trust-app should point to the real hook command in settings", failures)
    assert_true(not (fixture / "context" / "session-memory.md").exists(), "memory-trust-app should not include the stale session-memory file reference", failures)


def verify_expected_schema(failures: list[str]) -> None:
    required = [
        EXPECTED_DIR / "stale-context-app" / "audit" / "summary.json",
        EXPECTED_DIR / "stale-context-app" / "audit" / "findings.json",
        EXPECTED_DIR / "stale-context-app" / "align" / "findings.json",
        EXPECTED_DIR / "memory-trust-app" / "audit" / "summary.json",
        EXPECTED_DIR / "memory-trust-app" / "audit" / "findings.json",
        EXPECTED_DIR / "memory-trust-app" / "align" / "findings.json",
        EXPECTED_DIR / "memory-trust-app" / "upgrade" / "plan.json",
    ]
    for path in required:
        assert_true(path.is_file(), f"missing expected-results file: {path.relative_to(ROOT)}", failures)
        if path.is_file():
            data = load_json(path)
            assert_true("fixture" in data, f"{path.relative_to(ROOT)} must include fixture", failures)
            assert_true("skill" in data, f"{path.relative_to(ROOT)} must include skill", failures)
            assert_true("status" in data, f"{path.relative_to(ROOT)} must include status", failures)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify context-setup fixtures, baselines, and golden outputs.")
    parser.add_argument("--fixture", choices=["minimal-node-app", "fullstack-app", "stale-context-app", "memory-trust-app", "all"], default="all")
    parser.add_argument("--mode", choices=["contract", "golden", "all"], default="all")
    args = parser.parse_args()

    failures: list[str] = []
    if args.mode in ("contract", "all"):
        verify_expected_schema(failures)

        if args.fixture in ("minimal-node-app", "all"):
            verify_minimal(failures)
        if args.fixture in ("fullstack-app", "all"):
            verify_fullstack(failures)
        if args.fixture in ("stale-context-app", "all"):
            verify_stale(failures)
        if args.fixture in ("memory-trust-app", "all"):
            verify_memory_trust(failures)

    if args.mode in ("golden", "all"):
        if args.fixture in ("minimal-node-app", "all"):
            verify_scaffold_manifest("minimal-node-app", failures)
        if args.fixture in ("fullstack-app", "all"):
            verify_scaffold_manifest("fullstack-app", failures)
        if args.fixture in ("memory-trust-app", "all"):
            verify_scaffold_manifest("memory-trust-app", failures)
        if args.fixture in ("stale-context-app", "all"):
            verify_audit_golden(failures)
            verify_align_golden(failures)
        if args.fixture in ("memory-trust-app", "all"):
            verify_memory_trust_golden(failures)
            verify_upgrade_golden(failures)

    if failures:
        print("context-setup verification failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("context-setup verification passed")
    if args.fixture == "all":
        print("- verified fixtures: minimal-node-app, fullstack-app, stale-context-app, memory-trust-app")
        if args.mode in ("contract", "all"):
            print("- verified contract baselines: scaffold, audit, align")
        if args.mode in ("golden", "all"):
            print("- verified golden baselines: scaffold(minimal-node-app, fullstack-app, memory-trust-app), audit(stale-context-app, memory-trust-app), align(stale-context-app, memory-trust-app), upgrade(memory-trust-app)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

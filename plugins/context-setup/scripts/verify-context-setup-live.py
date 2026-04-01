#!/usr/bin/env python3
"""
verify-context-setup-live.py -- Live output verification for context-setup.

Validates generated outputs from real skill runs against structured assertions.
Does NOT execute skills -- it validates outputs that were already generated
into a working directory.

Usage:
  python3 verify-context-setup-live.py <working_dir> <assertions_json>

  working_dir:     Directory containing generated outputs (AGENTS.md, CLAUDE.md, etc.)
  assertions_json: Path to the assertions.json file for this fixture+skill combo

Exit codes:
  0 = all assertions pass
  1 = one or more assertions failed
"""

import argparse
import json
import os
import sys


def normalize(text):
    """Normalize text for comparison: strip trailing whitespace per line,
    normalize line endings, collapse multiple blank lines."""
    lines = text.replace("\r\n", "\n").split("\n")
    lines = [line.rstrip() for line in lines]
    # Collapse runs of 3+ blank lines to 2
    normalized = []
    blank_count = 0
    for line in lines:
        if line == "":
            blank_count += 1
            if blank_count <= 2:
                normalized.append(line)
        else:
            blank_count = 0
            normalized.append(line)
    return "\n".join(normalized).strip() + "\n"


def check_exact(working_dir, exact, failures):
    """Check exact assertions: file existence, symlink, recommendation."""

    # Expected files
    for f in exact.get("expected_files", []):
        path = os.path.join(working_dir, f)
        if not os.path.exists(path):
            failures.append(f"EXACT: expected file missing: {f}")

    # Forbidden files
    for f in exact.get("forbidden_files", []):
        path = os.path.join(working_dir, f)
        if os.path.exists(path):
            failures.append(f"EXACT: forbidden file exists: {f}")

    # CLAUDE.md symlink check
    if exact.get("claude_md_is_symlink"):
        claude_path = os.path.join(working_dir, "CLAUDE.md")
        if os.path.exists(claude_path):
            if not os.path.islink(claude_path):
                failures.append(
                    "EXACT: CLAUDE.md exists but is not a symlink"
                )
            else:
                target = os.readlink(claude_path)
                if "AGENTS.md" not in target:
                    failures.append(
                        f"EXACT: CLAUDE.md symlink points to "
                        f"'{target}' instead of AGENTS.md"
                    )
        else:
            failures.append("EXACT: CLAUDE.md does not exist")

    # Recommendation class check
    expected_rec = exact.get("recommendation")
    if expected_rec:
        agents_path = os.path.join(working_dir, "AGENTS.md")
        if os.path.isfile(agents_path):
            with open(agents_path, "r", encoding="utf-8") as f:
                content = f.read()
            lines = content.strip().split("\n")
            line_count = len(lines)
            has_context_dir = os.path.isdir(
                os.path.join(working_dir, "context")
            )
            # Count H2 headings to gauge complexity
            h2_count = sum(
                1 for line in lines if line.startswith("## ")
            )

            # Count context/ files that scaffold would generate
            # for cascading (architecture-decisions, operational-boundaries, etc.)
            cascading_context_files = [
                "architecture-decisions.md",
                "operational-boundaries.md",
                "technical-requirements.md",
                "api-documentation.md",
                "working-style-guide.md",
            ]
            context_dir = os.path.join(working_dir, "context")
            generated_context_count = 0
            if os.path.isdir(context_dir):
                for cf in cascading_context_files:
                    if os.path.isfile(os.path.join(context_dir, cf)):
                        generated_context_count += 1

            # Infer actual recommendation from output shape
            # Cascading: short root (<= 80 lines) AND multiple
            # scaffold-generated context/ files
            if generated_context_count >= 3 and line_count <= 80:
                actual_rec = "cascading"
            elif h2_count >= 6 or line_count > 50:
                actual_rec = "full_single_file"
            else:
                actual_rec = "minimal"

            if actual_rec != expected_rec:
                failures.append(
                    f"EXACT: recommendation mismatch -- "
                    f"expected '{expected_rec}', inferred "
                    f"'{actual_rec}' from output shape "
                    f"({line_count} lines, {h2_count} H2 headings, "
                    f"context/ dir: {has_context_dir})"
                )


def check_structural(working_dir, structural, failures):
    """Check structural assertions: headings, forbidden headings, line count."""

    agents_path = os.path.join(working_dir, "AGENTS.md")
    if not os.path.isfile(agents_path):
        failures.append("STRUCTURAL: AGENTS.md not found, cannot check")
        return

    with open(agents_path, "r", encoding="utf-8") as f:
        content = f.read()

    content_normalized = normalize(content)
    lines = content_normalized.strip().split("\n")

    # Required headings
    for heading in structural.get("required_headings", []):
        found = False
        for line in lines:
            if line.strip().lower() == heading.lower():
                found = True
                break
        if not found:
            failures.append(
                f"STRUCTURAL: required heading missing: {heading}"
            )

    # Forbidden headings
    for heading in structural.get("forbidden_headings", []):
        for line in lines:
            if line.strip().lower() == heading.lower():
                failures.append(
                    f"STRUCTURAL: forbidden heading present: {heading}"
                )
                break

    # Line count envelope
    envelope = structural.get("line_count_envelope", {})
    if envelope:
        count = len(lines)
        min_lines = envelope.get("min", 0)
        max_lines = envelope.get("max", 99999)
        if count < min_lines:
            failures.append(
                f"STRUCTURAL: AGENTS.md is {count} lines, "
                f"below minimum {min_lines}"
            )
        if count > max_lines:
            failures.append(
                f"STRUCTURAL: AGENTS.md is {count} lines, "
                f"above maximum {max_lines}"
            )


def check_semantic(working_dir, semantic, failures):
    """Check semantic signal assertions: required/forbidden substrings."""

    agents_path = os.path.join(working_dir, "AGENTS.md")
    if not os.path.isfile(agents_path):
        failures.append("SEMANTIC: AGENTS.md not found, cannot check")
        return

    with open(agents_path, "r", encoding="utf-8") as f:
        content = f.read()

    content_lower = content.lower()

    # Required signals
    for signal in semantic.get("required_signals", []):
        if signal.lower() not in content_lower:
            failures.append(
                f"SEMANTIC: required signal missing: '{signal}'"
            )

    # Forbidden signals
    for signal in semantic.get("forbidden_signals", []):
        if signal.lower() in content_lower:
            failures.append(
                f"SEMANTIC: forbidden signal present: '{signal}'"
            )


def verify(working_dir, assertions_path):
    """Run all assertion checks against a working directory."""

    with open(assertions_path, "r", encoding="utf-8") as f:
        assertions = json.load(f)

    fixture = assertions.get("fixture", "unknown")
    skill = assertions.get("skill", "unknown")

    failures = []

    if "exact" in assertions:
        check_exact(working_dir, assertions["exact"], failures)

    if "structural" in assertions:
        check_structural(working_dir, assertions["structural"], failures)

    if "semantic" in assertions:
        check_semantic(working_dir, assertions["semantic"], failures)

    return fixture, skill, failures


def main():
    parser = argparse.ArgumentParser(
        description="Validate live skill outputs against structured assertions."
    )
    parser.add_argument(
        "working_dir",
        help="Directory containing generated outputs",
    )
    parser.add_argument(
        "assertions_json",
        help="Path to assertions.json file",
    )
    args = parser.parse_args()

    if not os.path.isdir(args.working_dir):
        print(f"Error: {args.working_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(args.assertions_json):
        print(
            f"Error: {args.assertions_json} not found",
            file=sys.stderr,
        )
        sys.exit(1)

    fixture, skill, failures = verify(args.working_dir, args.assertions_json)

    if failures:
        print(f"FAIL: {fixture} / {skill}", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)
    else:
        print(f"PASS: {fixture} / {skill} -- all assertions satisfied")
        sys.exit(0)


if __name__ == "__main__":
    main()

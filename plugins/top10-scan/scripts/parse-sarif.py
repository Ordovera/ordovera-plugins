#!/usr/bin/env python3
"""parse-sarif.py -- Parse SARIF 2.1.0 output into normalized findings JSON.

Usage: parse-sarif.py <sarif_file_path>
Output: JSON to stdout, errors to stderr.
"""

import argparse
import json
import re
import sys


def extract_cwe_ids(rule):
    """Extract CWE IDs from a SARIF rule object."""
    cwes = set()
    cwe_pattern = re.compile(r"CWE-(\d+)", re.IGNORECASE)

    # Check rule.properties.tags
    properties = rule.get("properties", {})
    tags = properties.get("tags", [])
    if isinstance(tags, list):
        for tag in tags:
            match = cwe_pattern.search(str(tag))
            if match:
                cwes.add(int(match.group(1)))

    # Check properties.cwe directly
    cwe_val = properties.get("cwe", None)
    if cwe_val is not None:
        if isinstance(cwe_val, list):
            for item in cwe_val:
                match = cwe_pattern.search(str(item))
                if match:
                    cwes.add(int(match.group(1)))
        else:
            match = cwe_pattern.search(str(cwe_val))
            if match:
                cwes.add(int(match.group(1)))

    # Check rule.properties directly for CWE pattern
    for key, val in properties.items():
        if key in ("tags", "cwe"):
            continue
        match = cwe_pattern.search(str(val))
        if match:
            cwes.add(int(match.group(1)))

    return sorted(cwes)


def map_level_to_severity(level):
    """Map SARIF level to severity string."""
    mapping = {
        "error": "ERROR",
        "warning": "WARNING",
        "note": "INFO",
        "none": "INFO",
    }
    return mapping.get(level.lower(), "WARNING") if level else "WARNING"


def parse_sarif(sarif_path):
    """Parse a SARIF file and return normalized findings."""
    try:
        with open(sarif_path, "r", encoding="utf-8") as f:
            sarif = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(json.dumps({
            "error": "parse_failed",
            "message": f"Failed to parse SARIF file: {e}",
        }))
        sys.exit(0)

    findings = []
    runs = sarif.get("runs", [])

    for run in runs:
        # Build rule lookup
        tool_rules = {}
        tool_component = run.get("tool", {}).get("driver", {})
        for rule in tool_component.get("rules", []):
            rule_id = rule.get("id", "")
            tool_rules[rule_id] = rule

        # Also check extensions
        for ext in run.get("tool", {}).get("extensions", []):
            for rule in ext.get("rules", []):
                rule_id = rule.get("id", "")
                tool_rules[rule_id] = rule

        # Process results
        for result in run.get("results", []):
            rule_id = result.get("ruleId", "unknown")
            level = result.get("level", "warning")
            severity = map_level_to_severity(level)

            # Get message
            message_obj = result.get("message", {})
            message = message_obj.get("text", message_obj.get("markdown", ""))

            # Get location info
            file_path = ""
            line = 0
            snippet = ""

            locations = result.get("locations", [])
            if locations:
                loc = locations[0]
                phys = loc.get("physicalLocation", {})
                artifact = phys.get("artifactLocation", {})
                file_path = artifact.get("uri", "")

                region = phys.get("region", {})
                line = region.get("startLine", 0)

                snippet_obj = region.get("snippet", {})
                snippet = snippet_obj.get("text", "")

                # Try context region if no snippet
                if not snippet:
                    ctx = phys.get("contextRegion", {})
                    ctx_snippet = ctx.get("snippet", {})
                    snippet = ctx_snippet.get("text", "")

            # Extract CWE from rule definition
            rule_def = tool_rules.get(rule_id, {})
            cwes = extract_cwe_ids(rule_def)

            # Also check result-level properties for CWE
            if not cwes:
                result_props = result.get("properties", {})
                cwe_pattern = re.compile(r"CWE-(\d+)", re.IGNORECASE)
                for val in result_props.values():
                    match = cwe_pattern.search(str(val))
                    if match:
                        cwes.append(int(match.group(1)))
                cwes = sorted(set(cwes))

            findings.append({
                "rule_id": rule_id,
                "severity": severity,
                "message": message.strip(),
                "file": file_path,
                "line": line,
                "cwe": cwes,
                "snippet": snippet.strip(),
                "source": "sast",
            })

    # Compute stats
    by_severity = {}
    for f in findings:
        sev = f["severity"]
        by_severity[sev] = by_severity.get(sev, 0) + 1

    output = {
        "findings": findings,
        "stats": {
            "total": len(findings),
            "by_severity": by_severity,
        },
    }

    return output


def main():
    parser = argparse.ArgumentParser(
        description="Parse SARIF 2.1.0 files into normalized findings JSON."
    )
    parser.add_argument("sarif_file", help="Path to the SARIF file to parse")
    args = parser.parse_args()

    result = parse_sarif(args.sarif_file)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

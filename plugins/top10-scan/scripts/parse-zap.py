#!/usr/bin/env python3
"""parse-zap.py -- Parse ZAP JSON report into normalized findings JSON.

Usage: parse-zap.py <zap_json_file_path>
Output: JSON to stdout, errors to stderr.
"""

import argparse
import json
import sys


RISK_MAP = {
    0: "INFORMATIONAL",
    1: "LOW",
    2: "MEDIUM",
    3: "HIGH",
}

CONFIDENCE_MAP = {
    0: "FALSE_POSITIVE",
    1: "LOW",
    2: "MEDIUM",
    3: "HIGH",
}


def parse_zap_report(zap_path):
    """Parse a ZAP JSON report and return normalized findings."""
    try:
        with open(zap_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(json.dumps({
            "error": "parse_failed",
            "message": f"Failed to parse ZAP JSON file: {e}",
        }))
        sys.exit(0)

    findings = []
    sites = data.get("site", [])

    # Handle case where site is a single object instead of an array
    if isinstance(sites, dict):
        sites = [sites]

    for site in sites:
        alerts = site.get("alerts", [])

        for alert in alerts:
            rule_id = alert.get("pluginid", alert.get("alertRef", "unknown"))
            title = alert.get("alert", alert.get("name", "Unknown Alert"))
            risk_code = int(alert.get("riskcode", 0))
            confidence_code = int(alert.get("confidence", 0))
            severity = RISK_MAP.get(risk_code, "INFORMATIONAL")
            confidence = CONFIDENCE_MAP.get(confidence_code, "LOW")

            description = alert.get("desc", "")
            solution = alert.get("solution", "")

            # Extract CWE
            cwes = []
            cwe_id = alert.get("cweid", "")
            if cwe_id:
                try:
                    cwe_int = int(cwe_id)
                    if cwe_int > 0:
                        cwes.append(cwe_int)
                except (ValueError, TypeError):
                    pass

            # Process instances -- one finding per unique (url, parameter)
            instances = alert.get("instances", [])
            seen = set()

            if instances:
                for instance in instances:
                    url = instance.get("uri", "")
                    method = instance.get("method", "")
                    parameter = instance.get("param", "")
                    evidence = instance.get("evidence", "")

                    dedup_key = (url, parameter)
                    if dedup_key in seen:
                        continue
                    seen.add(dedup_key)

                    findings.append({
                        "rule_id": str(rule_id),
                        "title": title,
                        "severity": severity,
                        "url": url,
                        "method": method,
                        "parameter": parameter,
                        "evidence": evidence,
                        "cwe": cwes,
                        "description": description,
                        "solution": solution,
                        "confidence": confidence,
                        "source": "dast",
                    })
            else:
                # Alert with no instances -- still include it
                findings.append({
                    "rule_id": str(rule_id),
                    "title": title,
                    "severity": severity,
                    "url": "",
                    "method": "",
                    "parameter": "",
                    "evidence": "",
                    "cwe": cwes,
                    "description": description,
                    "solution": solution,
                    "confidence": confidence,
                    "source": "dast",
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
        description="Parse ZAP JSON report into normalized findings JSON."
    )
    parser.add_argument("zap_file", help="Path to the ZAP JSON report file")
    args = parser.parse_args()

    result = parse_zap_report(args.zap_file)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

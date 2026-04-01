#!/usr/bin/env python3
"""
synthesize.py - Multi-layer security finding synthesizer for OWASP Top 10 scanning.

Correlates findings from SAST, SCA, DAST, and design review layers,
deduplicates, maps to OWASP categories via CWE, scores severity,
and generates markdown and SARIF reports.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# CWE-to-OWASP mapping
# ---------------------------------------------------------------------------

def build_cwe_map(top10_path):
    """Build {cwe_id: owasp_category_id} from top10.json."""
    with open(top10_path, "r") as fh:
        data = json.load(fh)
    cwe_map = {}
    for cat in data.get("categories", []):
        cat_id = cat["id"]
        for cwe in cat.get("cwes", []):
            cwe_map[cwe] = cat_id
    return cwe_map, data


def get_cwes(finding):
    """Extract CWE list from a finding, handling both 'cwe' and 'cwe_ids' keys."""
    cwes = finding.get("cwe_ids") or finding.get("cwe") or []
    if isinstance(cwes, int):
        cwes = [cwes]
    return cwes


def map_finding_to_owasp(finding, cwe_map):
    """Attach owasp_category to a finding based on its CWE ids."""
    cwe_ids = get_cwes(finding)
    # Normalize to cwe_ids for downstream consistency
    finding["cwe_ids"] = cwe_ids
    for cwe in cwe_ids:
        if cwe in cwe_map:
            finding["owasp_category"] = cwe_map[cwe]
            return
    finding["owasp_category"] = "Unmapped"


# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------

def load_json(path):
    """Load a JSON file, return empty list on missing/invalid."""
    if not path or not os.path.isfile(path):
        return []
    try:
        with open(path, "r") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            # Try known top-level keys in order of specificity
            for key in ("findings", "vulnerabilities", "results"):
                if key in data and isinstance(data[key], list):
                    return data[key]
            return [data]
        return data if isinstance(data, list) else [data]
    except (json.JSONDecodeError, OSError):
        return []


def load_attack_surface(path):
    """Load attack surface JSON, return dict or empty dict."""
    if not path or not os.path.isfile(path):
        return {}
    try:
        with open(path, "r") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return {}


# ---------------------------------------------------------------------------
# Dedup algorithm
# ---------------------------------------------------------------------------

SEVERITY_RANK = {
    "critical": 5,
    "high": 4,
    "error": 4,
    "medium": 3,
    "warning": 3,
    "low": 2,
    "note": 1,
    "info": 1,
    "informational": 0,
    "none": 0,
}


def _sev_rank(finding):
    sev = finding.get("severity", "info").lower()
    return SEVERITY_RANK.get(sev, 0)


def dedup_sast(findings):
    """Group by (file, line, cwe) - keep highest severity."""
    groups = {}
    for f in findings:
        cwes = get_cwes(f) or [None]
        for cwe in cwes:
            key = (f.get("file", ""), f.get("line", 0), cwe)
            if key not in groups or _sev_rank(f) > _sev_rank(groups[key]):
                groups[key] = f
    return list(groups.values())


def dedup_dast(findings):
    """Group by (rule_id/title, parameter, cwe) - keep highest severity.

    ZAP produces one finding per URL for the same issue (e.g., missing CSP
    on every page).  Grouping by URL keeps all those duplicates.  Instead,
    group by the finding type so 57 per-URL instances collapse to ~16 unique
    finding types.  Store affected URLs in an 'affected_urls' list.
    """
    groups = {}
    for f in findings:
        cwes = get_cwes(f) or [None]
        finding_type = f.get("rule_id", f.get("alert", f.get("title", "")))
        for cwe in cwes:
            key = (finding_type, f.get("parameter", ""), cwe)
            if key not in groups or _sev_rank(f) > _sev_rank(groups[key]):
                groups[key] = dict(f)
                groups[key]["affected_urls"] = []
            url = f.get("url", "")
            if url and url not in groups[key].get("affected_urls", []):
                groups[key].setdefault("affected_urls", []).append(url)
    return list(groups.values())


def dedup_sca(findings):
    """Group by (package_name, advisory) - keep highest severity.

    A single advisory may have multiple CWEs; grouping per-CWE would
    duplicate the finding for each CWE.  Use the advisory ID as the
    dedup key instead, falling back to the sorted CWE tuple.
    """
    groups = {}
    for f in findings:
        pkg = f.get("package_name", f.get("name", ""))
        advisory = f.get("advisory_url", f.get("advisory", f.get("ghsa", "")))
        if not advisory:
            cwes = tuple(sorted(get_cwes(f) or []))
            advisory = str(cwes) if cwes else ""
        key = (pkg, advisory)
        if key not in groups or _sev_rank(f) > _sev_rank(groups[key]):
            groups[key] = f
    return list(groups.values())


def cross_layer_merge(sast_findings, dast_findings):
    """If a SAST finding's file maps to a DAST-tested route, mark confirmed."""
    dast_routes = set()
    for f in dast_findings:
        url = f.get("url", "")
        if url:
            dast_routes.add(url)
        route = f.get("route", "")
        if route:
            dast_routes.add(route)

    for f in sast_findings:
        file_path = f.get("file", "")
        route = f.get("route", "")
        if route and route in dast_routes:
            f["multi_layer_confirmed"] = True
            f["confirmed_sources"] = "SAST, DAST"
        elif file_path:
            basename = os.path.splitext(os.path.basename(file_path))[0]
            for dr in dast_routes:
                if basename.lower() in dr.lower():
                    f["multi_layer_confirmed"] = True
                    f["confirmed_sources"] = "SAST, DAST"
                    break


# ---------------------------------------------------------------------------
# Severity scoring (5-factor model)
# ---------------------------------------------------------------------------

def score_sast(finding, attack_surface):
    """Default scoring for SAST findings."""
    sev = finding.get("severity", "warning").lower()
    exploitability_map = {"error": 3, "warning": 2, "info": 1, "note": 1}
    factors = {
        "attack_vector": 3,
        "exposure": 2,
        "data_sensitivity": 2,
        "exploitability": exploitability_map.get(sev, 2),
        "impact": 2,
    }
    _adjust_from_attack_surface(finding, factors, attack_surface)
    return factors


def score_dast(finding, attack_surface):
    """Score DAST findings, seeded from ZAP's severity."""
    sev = finding.get("severity", "medium").lower()
    # DAST findings are runtime-confirmed, so attack_vector is always network (3).
    # Seed other factors from ZAP's severity to preserve differentiation.
    sev_factors = {
        "critical": {"exposure": 3, "data_sensitivity": 3, "exploitability": 3, "impact": 3},
        "high":     {"exposure": 3, "data_sensitivity": 2, "exploitability": 3, "impact": 3},
        "error":    {"exposure": 3, "data_sensitivity": 2, "exploitability": 3, "impact": 3},
        "medium":   {"exposure": 2, "data_sensitivity": 2, "exploitability": 2, "impact": 2},
        "warning":  {"exposure": 2, "data_sensitivity": 1, "exploitability": 2, "impact": 2},
        "low":      {"exposure": 1, "data_sensitivity": 1, "exploitability": 2, "impact": 1},
        "info":     {"exposure": 1, "data_sensitivity": 1, "exploitability": 1, "impact": 1},
    }
    base = sev_factors.get(sev, sev_factors["medium"])
    factors = {"attack_vector": 3}
    factors.update(base)
    _adjust_from_attack_surface(finding, factors, attack_surface)
    return factors


def score_sca(finding, attack_surface):
    """Score SCA findings, seeded from npm audit / tool severity and CVSS."""
    sev = finding.get("severity", "moderate").lower()
    cvss = finding.get("cvss_score", 0.0)
    # Seed from the tool's severity label
    sev_factors = {
        "critical": {"attack_vector": 3, "exposure": 3, "data_sensitivity": 3, "exploitability": 3, "impact": 3},
        "high":     {"attack_vector": 3, "exposure": 2, "data_sensitivity": 2, "exploitability": 3, "impact": 3},
        "moderate": {"attack_vector": 2, "exposure": 2, "data_sensitivity": 2, "exploitability": 2, "impact": 2},
        "medium":   {"attack_vector": 2, "exposure": 2, "data_sensitivity": 2, "exploitability": 2, "impact": 2},
        "low":      {"attack_vector": 1, "exposure": 1, "data_sensitivity": 1, "exploitability": 2, "impact": 1},
    }
    factors = dict(sev_factors.get(sev, sev_factors["moderate"]))
    # If CVSS score is present, let it bump impact/exploitability
    if cvss >= 9.0:
        factors["impact"] = max(factors["impact"], 3)
        factors["exploitability"] = max(factors["exploitability"], 3)
    elif cvss >= 7.0:
        factors["impact"] = max(factors["impact"], 2)
        factors["exploitability"] = max(factors["exploitability"], 3)
    _adjust_from_attack_surface(finding, factors, attack_surface)
    return factors


def score_design(finding, attack_surface):
    """Score design review findings, seeded from the reviewer's severity label."""
    sev = finding.get("severity", "medium").lower()
    # Design review findings carry severity from Claude's analysis.
    # Use that to seed factors so a HIGH IDOR doesn't score the same as LOW logging.
    sev_factors = {
        "critical": {"attack_vector": 3, "exposure": 3, "data_sensitivity": 3, "exploitability": 3, "impact": 3},
        "high":     {"attack_vector": 3, "exposure": 3, "data_sensitivity": 2, "exploitability": 2, "impact": 3},
        "medium":   {"attack_vector": 2, "exposure": 2, "data_sensitivity": 2, "exploitability": 2, "impact": 2},
        "low":      {"attack_vector": 1, "exposure": 1, "data_sensitivity": 1, "exploitability": 1, "impact": 2},
        "info":     {"attack_vector": 1, "exposure": 1, "data_sensitivity": 1, "exploitability": 1, "impact": 1},
    }
    factors = dict(sev_factors.get(sev, sev_factors["medium"]))
    _adjust_from_attack_surface(finding, factors, attack_surface)
    return factors


def _adjust_from_attack_surface(finding, factors, attack_surface):
    """Adjust exposure and data_sensitivity from attack surface data."""
    if not attack_surface:
        return
    endpoints = attack_surface.get("endpoints", [])
    if not isinstance(endpoints, list):
        return
    file_path = finding.get("file", "")
    route = finding.get("route", "") or finding.get("url", "")

    for ep in endpoints:
        ep_route = ep.get("route", "")
        match = False
        if route and ep_route and ep_route in route:
            match = True
        elif file_path and ep_route:
            basename = os.path.splitext(os.path.basename(file_path))[0]
            if basename.lower() in ep_route.lower():
                match = True
        if match:
            if ep.get("auth_required") is False:
                factors["exposure"] = 3
            elif ep.get("auth_required") is True:
                factors["exposure"] = 2
            sensitivity = ep.get("data_sensitivity", "").lower()
            if sensitivity in ("pii", "credentials", "high"):
                factors["data_sensitivity"] = 3
            elif sensitivity in ("business", "medium"):
                factors["data_sensitivity"] = 2
            elif sensitivity in ("public", "low"):
                factors["data_sensitivity"] = 1
            break


def composite_score(factors):
    """Sum of 5 factors (range 5-15)."""
    return sum(factors.values())


def severity_label(score):
    """Map composite score to severity label."""
    if score >= 13:
        return "Critical"
    if score >= 10:
        return "High"
    if score >= 7:
        return "Medium"
    if score >= 4:
        return "Low"
    return "Informational"


SCORE_FN = {
    "sast": score_sast,
    "dast": score_dast,
    "sca": score_sca,
    "design_review": score_design,
}


def apply_severity(findings, source, attack_surface):
    """Score each finding and attach severity_score and severity."""
    fn = SCORE_FN.get(source, score_design)
    for f in findings:
        f["source"] = source
        factors = fn(f, attack_surface)
        f["severity_factors"] = factors
        f["severity_score"] = composite_score(factors)
        f["severity"] = severity_label(f["severity_score"])


# ---------------------------------------------------------------------------
# Report generation - Markdown
# ---------------------------------------------------------------------------

def render_template(template_path, variables):
    """Simple {{variable}} substitution on a template file."""
    if not os.path.isfile(template_path):
        return ""
    with open(template_path, "r") as fh:
        content = fh.read()
    for key, val in variables.items():
        content = content.replace("{{" + key + "}}", str(val))
    return content


def build_category_sections(all_findings, top10_data):
    """Build markdown for each OWASP category."""
    categories = top10_data.get("categories", [])
    cat_map = {}
    for cat in categories:
        cat_map[cat["id"]] = {"id": cat["id"], "name": cat["name"], "findings": []}

    for f in all_findings:
        cat_id = f.get("owasp_category", "Unmapped")
        if cat_id in cat_map:
            cat_map[cat_id]["findings"].append(f)

    unmapped = [f for f in all_findings if f.get("owasp_category") == "Unmapped"]

    sections = []
    for cat in categories:
        cat_data = cat_map[cat["id"]]
        section = "### {}: {}\n\n".format(cat_data["id"], cat_data["name"])
        if cat_data["findings"]:
            for finding in sorted(cat_data["findings"], key=lambda x: x.get("severity_score", 0), reverse=True):
                section += render_finding(finding)
        else:
            section += "No findings in this category.\n"
        sections.append(section)

    if unmapped:
        section = "### Unmapped Findings\n\n"
        for finding in sorted(unmapped, key=lambda x: x.get("severity_score", 0), reverse=True):
            section += render_finding(finding)
        sections.append(section)

    return "\n".join(sections)


def render_finding(f):
    """Render a single finding as markdown."""
    title = f.get("title", f.get("rule_id", f.get("message", "Finding")))
    cwe_ids = f.get("cwe_ids", [])
    cwe_str = ", ".join("CWE-{}".format(c) for c in cwe_ids) if cwe_ids else "N/A"

    location = f.get("file", f.get("url", "N/A"))
    line = f.get("line")
    if line and location != "N/A":
        location = "{}:{}".format(location, line)

    lines = []
    lines.append("#### {}\n".format(title))
    lines.append("| Field | Value |")
    lines.append("|-------|-------|")
    lines.append("| Severity | {} (Score: {}) |".format(f.get("severity", "N/A"), f.get("severity_score", "N/A")))
    lines.append("| Source | {} |".format(f.get("source", "N/A")))
    lines.append("| OWASP Category | {} |".format(f.get("owasp_category", "N/A")))
    lines.append("| CWE | {} |".format(cwe_str))
    lines.append("| Location | {} |".format(location))
    if f.get("multi_layer_confirmed"):
        lines.append("| Confirmed By | {} |".format(f.get("confirmed_sources", "Multiple layers")))
    lines.append("")
    lines.append("**Description:** {}\n".format(f.get("description", f.get("message", "N/A"))))

    snippet = f.get("snippet", "")
    if snippet:
        lines.append("```")
        lines.append(snippet)
        lines.append("```\n")

    recommendation = f.get("recommendation", f.get("fix", "Review and remediate this finding."))
    lines.append("**Recommendation:** {}\n".format(recommendation))
    return "\n".join(lines) + "\n"


def build_attack_surface_section(attack_surface):
    """Build attack surface overview text."""
    if not attack_surface:
        return "No attack surface data provided."

    lines = []
    endpoints = attack_surface.get("endpoints", [])
    if endpoints:
        lines.append("**Endpoints:** {}".format(len(endpoints)))
        auth_count = sum(1 for e in endpoints if e.get("auth_required"))
        unauth_count = len(endpoints) - auth_count
        lines.append("  - Authenticated: {}".format(auth_count))
        lines.append("  - Unauthenticated: {}".format(unauth_count))

    auth_mechs = attack_surface.get("auth_mechanisms", [])
    if auth_mechs:
        lines.append("\n**Authentication Mechanisms:**")
        for m in auth_mechs:
            lines.append("  - {}: {}".format(m.get("name", "Unknown"), m.get("description", "")))

    integrations = attack_surface.get("integrations", [])
    if integrations:
        lines.append("\n**External Integrations:** {}".format(len(integrations)))

    secrets = attack_surface.get("secrets", [])
    if secrets:
        lines.append("\n**Secrets Handling:** {} items tracked".format(len(secrets)))

    return "\n".join(lines) if lines else "No attack surface data provided."


def build_tool_coverage(sast_findings, sca_findings, dast_findings,
                        design_findings, sca_raw_data=None):
    """Determine tool status strings."""
    def status(findings):
        if findings:
            return "Completed ({} findings)".format(len(findings))
        return "Not run / No findings"

    # Determine actual SCA tool name from raw data if available
    sca_tool = "N/A"
    if sca_raw_data and isinstance(sca_raw_data, dict):
        sca_tool = sca_raw_data.get(
            "tool_used",
            sca_raw_data.get("package_manager", "SCA tool")
        )
    elif sca_findings:
        sca_tool = "SCA"

    return {
        "sast_status": status(sast_findings),
        "sca_tool": sca_tool,
        "sca_status": status(sca_findings),
        "dast_status": status(dast_findings),
        "design_status": status(design_findings),
    }


def generate_markdown(all_findings, top10_data, attack_surface,
                      framework, template_dir, sast, sca, dast, design,
                      sca_raw_data=None):
    """Generate the full markdown report."""
    severity_counts = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0, "Informational": 0}
    for f in all_findings:
        sev = f.get("severity", "Informational")
        if sev in severity_counts:
            severity_counts[sev] += 1

    total = len(all_findings)

    exec_lines = []
    if total == 0:
        exec_lines.append("No security findings were identified during this scan.")
    else:
        exec_lines.append("This scan identified **{}** finding(s) across the application.".format(total))
        if severity_counts["Critical"] > 0:
            exec_lines.append(
                "**{} critical** finding(s) require immediate attention.".format(severity_counts["Critical"])
            )
        if severity_counts["High"] > 0:
            exec_lines.append(
                "{} high-severity finding(s) should be addressed promptly.".format(severity_counts["High"])
            )

    categories_section = build_category_sections(all_findings, top10_data)
    attack_section = build_attack_surface_section(attack_surface)
    coverage = build_tool_coverage(sast, sca, dast, design, sca_raw_data)

    template_path = os.path.join(template_dir, "report.md")
    variables = {
        "project_name": os.path.basename(os.getcwd()),
        "framework": framework or "Unknown",
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "owasp_version": top10_data.get("version", "2025"),
        "executive_summary": "\n".join(exec_lines),
        "total_findings": str(total),
        "critical_count": str(severity_counts["Critical"]),
        "high_count": str(severity_counts["High"]),
        "medium_count": str(severity_counts["Medium"]),
        "low_count": str(severity_counts["Low"]),
        "info_count": str(severity_counts["Informational"]),
        "sast_status": coverage["sast_status"],
        "sca_tool": coverage["sca_tool"],
        "sca_status": coverage["sca_status"],
        "dast_status": coverage["dast_status"],
        "design_status": coverage["design_status"],
        "attack_surface": attack_section,
    }

    report = render_template(template_path, variables)

    # Replace the categories placeholder area with actual content.
    # The template uses handlebars-style blocks we cannot process,
    # so we replace everything between the category markers.
    cat_start = report.find("{{#each categories}}")
    cat_end = report.find("{{/each}}", cat_start) + len("{{/each}}") if cat_start != -1 else -1
    if cat_start != -1 and cat_end != -1:
        report = report[:cat_start] + categories_section + report[cat_end:]

    # Clean up any remaining handlebars artifacts
    handlebars_prefixes = ("{{#", "{{/", "{{>", "{{else}}")
    while any(p in report for p in handlebars_prefixes):
        start = -1
        for prefix in handlebars_prefixes:
            idx = report.find(prefix)
            if idx != -1 and (start == -1 or idx < start):
                start = idx
        if start == -1:
            break
        end = report.find("}}", start) + 2
        # Remove the entire line if it's only a handlebars block
        line_start = report.rfind("\n", 0, start)
        line_end = report.find("\n", end)
        line_content = report[line_start + 1:line_end].strip() if line_end != -1 else ""
        if line_content.startswith("{{") and line_content.endswith("}}"):
            # Whole line is just a handlebars tag, remove the line
            report = report[:line_start + 1] + report[line_end + 1:] if line_end != -1 else report[:line_start + 1]
        else:
            report = report[:start] + report[end:]

    return report, severity_counts


# ---------------------------------------------------------------------------
# Report generation - SARIF
# ---------------------------------------------------------------------------

SARIF_LEVEL_MAP = {
    "Critical": "error",
    "High": "error",
    "Medium": "warning",
    "Low": "note",
    "Informational": "note",
}


def build_sarif(all_findings, top10_data):
    """Build SARIF 2.1.0 output."""
    runs_by_source = {}
    for f in all_findings:
        source = f.get("source", "unknown")
        if source not in runs_by_source:
            runs_by_source[source] = {"tool": source, "results": [], "rules": {}}
        run = runs_by_source[source]

        rule_id = f.get("rule_id", f.get("title", "finding"))
        cwe_ids = f.get("cwe_ids", [])

        if rule_id not in run["rules"]:
            run["rules"][rule_id] = {
                "id": rule_id,
                "shortDescription": {"text": f.get("title", f.get("message", rule_id))},
                "properties": {
                    "cwe": ["CWE-{}".format(c) for c in cwe_ids],
                    "owasp_category": f.get("owasp_category", "Unmapped"),
                },
            }

        location = {}
        if f.get("file"):
            artifact = {"uri": f["file"]}
            region = {}
            if f.get("line"):
                region["startLine"] = f["line"]
            location = {
                "physicalLocation": {
                    "artifactLocation": artifact,
                    "region": region,
                }
            }
        elif f.get("url"):
            location = {
                "physicalLocation": {
                    "artifactLocation": {"uri": f["url"]},
                }
            }

        result = {
            "ruleId": rule_id,
            "level": SARIF_LEVEL_MAP.get(f.get("severity", "Informational"), "note"),
            "message": {"text": f.get("description", f.get("message", ""))},
        }
        if location:
            result["locations"] = [location]
        if f.get("multi_layer_confirmed"):
            result["properties"] = {"multi_layer_confirmed": True}

        run["results"].append(result)

    sarif = {
        "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
        "version": "2.1.0",
        "runs": [],
    }

    for source, run_data in runs_by_source.items():
        sarif_run = {
            "tool": {
                "driver": {
                    "name": source,
                    "rules": list(run_data["rules"].values()),
                }
            },
            "results": run_data["results"],
        }
        sarif["runs"].append(sarif_run)

    if not sarif["runs"]:
        sarif["runs"].append({
            "tool": {"driver": {"name": "top10-scan", "rules": []}},
            "results": [],
        })

    return sarif


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Synthesize multi-layer security findings into OWASP Top 10 report")
    parser.add_argument("--sast-findings", help="JSON file from parse-sarif.py")
    parser.add_argument("--sca-findings", help="JSON file from run-sca.sh")
    parser.add_argument("--dast-findings", help="JSON file from parse-zap.py")
    parser.add_argument("--design-findings", help="JSON file with design review findings")
    parser.add_argument("--attack-surface", help="JSON file with attack surface data")
    parser.add_argument("--framework", help="Detected framework name")
    parser.add_argument("--owasp-cache", help="Path to owasp-cache directory",
                        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "owasp-cache"))
    parser.add_argument("--output-dir", help="Output directory", default=".")
    parser.add_argument("--format", choices=["markdown", "sarif", "both"], default="both",
                        help="Output format (default: both)")
    args = parser.parse_args()

    # Load OWASP data
    top10_path = os.path.join(args.owasp_cache, "top10.json")
    if not os.path.isfile(top10_path):
        print("ERROR: top10.json not found at {}".format(top10_path), file=sys.stderr)
        sys.exit(1)

    cwe_map, top10_data = build_cwe_map(top10_path)

    # Load raw SCA wrapper for tool metadata before extracting findings
    sca_raw_wrapper = None
    if args.sca_findings and os.path.isfile(args.sca_findings):
        try:
            with open(args.sca_findings, "r") as fh:
                sca_raw_wrapper = json.load(fh)
        except (json.JSONDecodeError, OSError):
            pass

    # Load findings
    sast_raw = load_json(args.sast_findings)
    sca_raw = load_json(args.sca_findings)
    dast_raw = load_json(args.dast_findings)
    design_raw = load_json(args.design_findings)
    attack_surface = load_attack_surface(args.attack_surface)

    # Tag sources
    for f in sast_raw:
        f.setdefault("source", "sast")
    for f in sca_raw:
        f.setdefault("source", "sca")
    for f in dast_raw:
        f.setdefault("source", "dast")
    for f in design_raw:
        f.setdefault("source", "design_review")

    # Dedup within layers
    sast = dedup_sast(sast_raw)
    sca = dedup_sca(sca_raw)
    dast = dedup_dast(dast_raw)
    design = design_raw  # no dedup for design review

    # Cross-layer merge
    cross_layer_merge(sast, dast)

    # Apply severity scoring
    apply_severity(sast, "sast", attack_surface)
    apply_severity(sca, "sca", attack_surface)
    apply_severity(dast, "dast", attack_surface)
    apply_severity(design, "design_review", attack_surface)

    # Map to OWASP categories
    all_findings = sast + sca + dast + design
    for f in all_findings:
        map_finding_to_owasp(f, cwe_map)

    # Determine template directory
    template_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "templates")

    # Generate outputs
    os.makedirs(args.output_dir, exist_ok=True)

    report_path = None
    sarif_path = None

    if args.format in ("markdown", "both"):
        report_content, severity_counts = generate_markdown(
            all_findings, top10_data, attack_surface,
            args.framework, template_dir, sast, sca, dast, design,
            sca_raw_data=sca_raw_wrapper
        )
        report_path = os.path.join(args.output_dir, "report.md")
        with open(report_path, "w") as fh:
            fh.write(report_content)

    if args.format in ("sarif", "both"):
        sarif_data = build_sarif(all_findings, top10_data)
        sarif_path = os.path.join(args.output_dir, "report.sarif")
        with open(sarif_path, "w") as fh:
            json.dump(sarif_data, fh, indent=2)

    # Compute summary
    severity_counts = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0, "Informational": 0}
    for f in all_findings:
        sev = f.get("severity", "Informational")
        if sev in severity_counts:
            severity_counts[sev] += 1

    categories_affected = sorted(set(
        f.get("owasp_category") for f in all_findings if f.get("owasp_category") != "Unmapped"
    ))

    summary = {
        "report_path": report_path,
        "sarif_path": sarif_path,
        "summary": {
            "total": len(all_findings),
            "critical": severity_counts["Critical"],
            "high": severity_counts["High"],
            "medium": severity_counts["Medium"],
            "low": severity_counts["Low"],
            "informational": severity_counts["Informational"],
            "categories_affected": categories_affected,
        },
    }

    print(json.dumps(summary))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
verify-top10-scan.py -- Contract and live verification for top10-scan.

Validates fixture integrity, expected-results structure, framework
detection accuracy, and OWASP cache consistency.

Usage:
  python3 verify-top10-scan.py [--mode contract|live|all]
"""

import argparse
import json
import os
import subprocess
import sys

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES_DIR = os.path.join(PLUGIN_DIR, "test-fixtures")
EXPECTED_DIR = os.path.join(PLUGIN_DIR, "expected-results")
OWASP_DIR = os.path.join(PLUGIN_DIR, "owasp-cache")
SCRIPTS_DIR = os.path.join(PLUGIN_DIR, "scripts")
SIGNALS_PATH = os.path.join(SCRIPTS_DIR, "vulnerability-signals.json")

FIXTURES = [
    "vulnerable-nextjs", "vulnerable-express", "vulnerable-django",
    "vulnerable-fastapi", "vulnerable-php", "vulnerable-aspnet",
    "vulnerable-rust",
]

EXPECTED_FRAMEWORKS = {
    "vulnerable-nextjs": {"frameworks": ["nextjs"], "pkg_mgrs": ["npm"]},
    "vulnerable-express": {"frameworks": ["express"], "pkg_mgrs": ["npm"]},
    "vulnerable-django": {"frameworks": ["django"], "pkg_mgrs": []},
    "vulnerable-fastapi": {"frameworks": ["fastapi"], "pkg_mgrs": ["pip"]},
    "vulnerable-php": {"frameworks": ["php"], "pkg_mgrs": ["composer"]},
    "vulnerable-aspnet": {"frameworks": ["aspnet"], "pkg_mgrs": ["nuget"]},
    "vulnerable-rust": {"frameworks": ["rust"], "pkg_mgrs": ["cargo"]},
}


def load_vulnerability_signals():
    if os.path.isfile(SIGNALS_PATH):
        with open(SIGNALS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def verify_fixture_existence(failures):
    for fixture in FIXTURES:
        if not os.path.isdir(os.path.join(FIXTURES_DIR, fixture)):
            failures.append(f"FIXTURE: {fixture}/ directory missing")


def verify_fixture_readmes(failures):
    for fixture in FIXTURES:
        if not os.path.isfile(os.path.join(FIXTURES_DIR, fixture, "README.md")):
            failures.append(f"FIXTURE: {fixture}/README.md missing")


def verify_vulnerability_signals(failures):
    signals = load_vulnerability_signals()
    for fixture, file_signals in signals.items():
        fixture_dir = os.path.join(FIXTURES_DIR, fixture)
        if not os.path.isdir(fixture_dir):
            continue
        for rel_path, signal_list in file_signals.items():
            full_path = os.path.join(fixture_dir, rel_path)
            if not os.path.isfile(full_path):
                failures.append(f"SIGNAL: {fixture}/{rel_path} missing")
                continue
            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception as e:
                failures.append(f"SIGNAL: {fixture}/{rel_path} unreadable: {e}")
                continue
            for signal in signal_list:
                if signal not in content:
                    failures.append(
                        f"SIGNAL: {fixture}/{rel_path} missing "
                        f"vulnerability signal: '{signal}'"
                    )


def verify_expected_results(failures):
    required_keys = ["fixture", "expected_findings", "minimum_finding_count", "required_categories"]
    finding_keys = ["category", "description", "file", "source"]
    for fixture in FIXTURES:
        short = fixture.replace("vulnerable-", "")
        baseline = os.path.join(EXPECTED_DIR, f"{short}-baseline.json")
        if not os.path.isfile(baseline):
            failures.append(f"BASELINE: {short}-baseline.json missing")
            continue
        try:
            with open(baseline, "r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            failures.append(f"BASELINE: {short}-baseline.json invalid JSON: {e}")
            continue
        for key in required_keys:
            if key not in data:
                failures.append(f"BASELINE: {short}-baseline.json missing key: {key}")
        findings = data.get("expected_findings", [])
        if not findings:
            failures.append(f"BASELINE: {short}-baseline.json has empty findings")
        for i, finding in enumerate(findings):
            for key in finding_keys:
                if key not in finding:
                    failures.append(f"BASELINE: {short}-baseline.json finding[{i}] missing key: {key}")
        for cat in data.get("required_categories", []):
            if not cat.startswith("A") or not cat[1:].isdigit():
                failures.append(f"BASELINE: {short}-baseline.json invalid category ID: {cat}")


def verify_framework_detection(failures):
    detect_script = os.path.join(SCRIPTS_DIR, "detect-framework.py")
    if not os.path.isfile(detect_script):
        failures.append("DETECT: detect-framework.py missing")
        return
    for fixture, expected in EXPECTED_FRAMEWORKS.items():
        fixture_dir = os.path.join(FIXTURES_DIR, fixture)
        if not os.path.isdir(fixture_dir):
            continue
        try:
            result = subprocess.run(
                ["python3", detect_script, fixture_dir],
                capture_output=True, text=True, timeout=10,
            )
            data = json.loads(result.stdout)
        except Exception as e:
            failures.append(f"DETECT: {fixture} failed: {e}")
            continue
        actual_fw = data.get("frameworks", [])
        if actual_fw != expected["frameworks"]:
            failures.append(f"DETECT: {fixture} frameworks expected {expected['frameworks']}, got {actual_fw}")
        actual_mgrs = [m["name"] for m in data.get("package_managers", [])]
        if actual_mgrs != expected["pkg_mgrs"]:
            failures.append(f"DETECT: {fixture} pkg_mgrs expected {expected['pkg_mgrs']}, got {actual_mgrs}")


def verify_owasp_cache(failures):
    top10_path = os.path.join(OWASP_DIR, "top10.json")
    if not os.path.isfile(top10_path):
        failures.append("OWASP: top10.json missing")
        return
    try:
        with open(top10_path, "r", encoding="utf-8") as f:
            top10 = json.load(f)
    except json.JSONDecodeError as e:
        failures.append(f"OWASP: top10.json invalid JSON: {e}")
        return
    categories = top10.get("categories", [])
    if len(categories) != 10:
        failures.append(f"OWASP: top10.json has {len(categories)} categories, expected 10")
    expected_ids = [f"A{str(i).zfill(2)}" for i in range(1, 11)]
    actual_ids = [c.get("id") for c in categories]
    if actual_ids != expected_ids:
        failures.append(f"OWASP: category IDs expected {expected_ids}, got {actual_ids}")
    for cat in categories:
        cid = cat.get("id", "?")
        if not cat.get("cwes"):
            failures.append(f"OWASP: {cid} has empty CWE list")
        if not cat.get("name"):
            failures.append(f"OWASP: {cid} has no name")
        if not cat.get("description"):
            failures.append(f"OWASP: {cid} has no description")
    for i, a in enumerate(categories):
        for b in categories[i + 1:]:
            overlap = set(a.get("cwes", [])) & set(b.get("cwes", []))
            # A03 and A08 legitimately share CWEs (A03 evolved from A08:2021)
            threshold = 10 if {a["id"], b["id"]} == {"A03", "A08"} else 5
            if len(overlap) > threshold:
                failures.append(f"OWASP: {a['id']} and {b['id']} share {len(overlap)} CWEs")

    prompts_path = os.path.join(OWASP_DIR, "review-prompts.json")
    if not os.path.isfile(prompts_path):
        failures.append("OWASP: review-prompts.json missing")
        return
    try:
        with open(prompts_path, "r", encoding="utf-8") as f:
            prompts = json.load(f)
    except json.JSONDecodeError as e:
        failures.append(f"OWASP: review-prompts.json invalid JSON: {e}")
        return
    expected_hints = ["nextjs", "express", "django", "rails", "spring", "go", "php", "fastapi", "aspnet"]
    for cid in expected_ids:
        if cid not in prompts:
            failures.append(f"OWASP: review-prompts.json missing {cid}")
            continue
        entry = prompts[cid]
        if not entry.get("prompt"):
            failures.append(f"OWASP: {cid} has empty prompt")
        for hint in expected_hints:
            if hint not in entry.get("framework_hints", {}):
                failures.append(f"OWASP: {cid} missing hint: {hint}")

    state_path = os.path.join(OWASP_DIR, "state.json")
    if not os.path.isfile(state_path):
        failures.append("OWASP: state.json missing")
    else:
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                state = json.load(f)
            if state.get("current_version") != "2025":
                failures.append(f"OWASP: state.json version is '{state.get('current_version')}', expected '2025'")
        except json.JSONDecodeError as e:
            failures.append(f"OWASP: state.json invalid JSON: {e}")


def verify_live(working_dir, assertions_path, failures):
    if not os.path.isfile(assertions_path):
        failures.append(f"LIVE: assertions missing: {assertions_path}")
        return
    with open(assertions_path, "r", encoding="utf-8") as f:
        assertions = json.load(f)
    fixture = assertions.get("fixture", "unknown")
    findings_path = os.path.join(working_dir, "findings.json")
    if not os.path.isfile(findings_path):
        failures.append(f"LIVE: {fixture} findings.json missing")
        return
    with open(findings_path, "r", encoding="utf-8") as f:
        findings = json.load(f)
    actual = findings.get("findings", [])
    min_count = assertions.get("minimum_finding_count", 0)
    if len(actual) < min_count:
        failures.append(f"LIVE: {fixture} has {len(actual)} findings, minimum {min_count}")
    actual_cats = set(f.get("category", "") for f in actual)
    for cat in assertions.get("required_categories", []):
        if cat not in actual_cats:
            failures.append(f"LIVE: {fixture} missing category: {cat}")
    all_text = " ".join(f.get("description", "") + " " + f.get("title", "") for f in actual).lower()
    for signal in assertions.get("required_signals", []):
        if signal.lower() not in all_text:
            failures.append(f"LIVE: {fixture} missing signal: '{signal}'")


def verify_synthesis_pipeline(failures):
    """Run synthesize.py with test inputs and validate the output."""
    import tempfile

    synth_script = os.path.join(SCRIPTS_DIR, "synthesize.py")
    fixture_dir = os.path.join(FIXTURES_DIR, "synthesis-pipeline")
    sast = os.path.join(fixture_dir, "sast.json")
    sca = os.path.join(fixture_dir, "sca.json")
    design = os.path.join(fixture_dir, "design.json")

    if not all(os.path.isfile(f) for f in [synth_script, sast, sca, design]):
        failures.append("SYNTH: synthesis pipeline test fixtures missing")
        return

    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            result = subprocess.run(
                [
                    "python3", synth_script,
                    "--sast-findings", sast,
                    "--sca-findings", sca,
                    "--design-findings", design,
                    "--framework", "nextjs",
                    "--owasp-cache", OWASP_DIR,
                    "--output-dir", tmpdir,
                    "--format", "both",
                ],
                capture_output=True, text=True, timeout=30,
            )
        except Exception as e:
            failures.append(f"SYNTH: synthesize.py failed to run: {e}")
            return

        if result.returncode != 0:
            failures.append(
                f"SYNTH: synthesize.py exited {result.returncode}: "
                f"{result.stderr.strip()}"
            )
            return

        # Parse stdout JSON summary
        try:
            output = json.loads(result.stdout)
        except json.JSONDecodeError:
            failures.append(
                f"SYNTH: synthesize.py stdout is not valid JSON: "
                f"{result.stdout[:200]}"
            )
            return

        # Summary may be nested under "summary" key
        summary = output.get("summary", output)

        # Validate finding count (1 SAST + 1 SCA + 2 design = 4,
        # possibly less after dedup; at least 3)
        total = summary.get("total", 0)
        if total < 3:
            failures.append(
                f"SYNTH: expected at least 3 findings, got {total}"
            )

        # Validate OWASP categories mapped correctly
        cats = summary.get("categories_affected", [])
        for required_cat in ["A01", "A03", "A05", "A07"]:
            if required_cat not in cats:
                failures.append(
                    f"SYNTH: category {required_cat} missing "
                    f"from synthesis output (got {cats})"
                )

        # Validate report.md exists and is non-trivial
        report_path = os.path.join(tmpdir, "report.md")
        if not os.path.isfile(report_path):
            failures.append("SYNTH: report.md not generated")
        else:
            with open(report_path, "r") as fh:
                report = fh.read()
            if len(report) < 500:
                failures.append(
                    f"SYNTH: report.md is only {len(report)} chars"
                )
            # No handlebars artifacts should remain
            for artifact in ["{{#", "{{/", "{{else}}", "{{>"]:
                if artifact in report:
                    failures.append(
                        f"SYNTH: report.md contains template "
                        f"artifact: {artifact}"
                    )
            # SCA finding should be mapped, not Unmapped
            if "Unmapped" in report:
                failures.append(
                    "SYNTH: report.md has Unmapped findings "
                    "(CWE mapping incomplete)"
                )
            # Tool name should be from fixture, not hardcoded
            if "npm audit" not in report:
                failures.append(
                    "SYNTH: report.md missing SCA tool name "
                    "'npm audit' from fixture data"
                )

        # Validate report.sarif exists
        sarif_path = os.path.join(tmpdir, "report.sarif")
        if not os.path.isfile(sarif_path):
            failures.append("SYNTH: report.sarif not generated")
        else:
            try:
                with open(sarif_path, "r") as fh:
                    sarif = json.load(fh)
                if sarif.get("$schema") is None and sarif.get("version") is None:
                    failures.append("SYNTH: report.sarif missing schema/version")
            except json.JSONDecodeError:
                failures.append("SYNTH: report.sarif is not valid JSON")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["contract", "live", "all"], default="all")
    args = parser.parse_args()
    failures = []
    live_checked = []
    synth_ran = False

    if args.mode in ("contract", "all"):
        verify_fixture_existence(failures)
        verify_fixture_readmes(failures)
        verify_vulnerability_signals(failures)
        verify_expected_results(failures)
        verify_framework_detection(failures)
        verify_owasp_cache(failures)
        verify_synthesis_pipeline(failures)
        synth_ran = True

    if args.mode in ("live", "all"):
        for fixture in FIXTURES:
            short = fixture.replace("vulnerable-", "")
            a = os.path.join(EXPECTED_DIR, f"{short}-live-assertions.json")
            w = os.path.join(EXPECTED_DIR, f"{short}-live-output")
            if os.path.isfile(a) and os.path.isdir(w):
                verify_live(w, a, failures)
                live_checked.append(short)

    if failures:
        print("top10-scan verification FAILED", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)
    else:
        print("top10-scan verification passed")
        parts = ["7 fixtures, 7 baselines, 7 framework detections, OWASP cache"]
        if synth_ran:
            parts.append("synthesis pipeline")
        print(f"  - verified: {', '.join(parts)}")
        if live_checked:
            print(f"  - live design review: {', '.join(live_checked)}")
        sys.exit(0)


if __name__ == "__main__":
    main()

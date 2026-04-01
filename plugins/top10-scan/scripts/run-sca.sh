#!/usr/bin/env bash
set -euo pipefail

# run-sca.sh -- Software Composition Analysis
# Usage: run-sca.sh <target_dir> <package_manager>
# Output: JSON to stdout, errors to stderr

TARGET_DIR="${1:-}"
PACKAGE_MANAGER="${2:-}"

if [[ -z "$TARGET_DIR" || -z "$PACKAGE_MANAGER" ]]; then
  echo '{"error": "invalid_args", "tool": "sca", "message": "Usage: run-sca.sh <target_dir> <package_manager>"}' >&2
  exit 1
fi

# Cleanup on unexpected exit
cleanup() {
  local exit_code=$?
  if [[ $exit_code -ne 0 && -z "${HANDLED_ERROR:-}" ]]; then
    echo "{\"error\": \"scan_failed\", \"tool\": \"sca\", \"message\": \"Unexpected error (exit $exit_code)\", \"exit_code\": $exit_code}"
    exit 0
  fi
}
trap cleanup EXIT

normalize_npm_audit() {
  local json_file="$1"
  python3 -c "
import json, sys

try:
    with open('$json_file', 'r') as f:
        data = json.load(f)
except Exception as e:
    print(json.dumps({'error': 'parse_failed', 'message': str(e)}))
    sys.exit(0)

vulns = []
by_severity = {}
raw_vulns = data.get('vulnerabilities', {})

for pkg_name, pkg_data in raw_vulns.items():
    severity = pkg_data.get('severity', 'MODERATE').upper()
    by_severity[severity] = by_severity.get(severity, 0) + 1

    # Extract CWE and advisory info from via entries
    cwes = []
    advisory_url = ''
    title = ''
    cvss_score = 0.0
    for via_entry in pkg_data.get('via', []):
        if isinstance(via_entry, dict):
            cwe_list = via_entry.get('cwe', [])
            if isinstance(cwe_list, list):
                for cwe in cwe_list:
                    if isinstance(cwe, str) and cwe.startswith('CWE-'):
                        try:
                            cwes.append(int(cwe.split('-')[1]))
                        except (ValueError, IndexError):
                            pass
            if not advisory_url:
                advisory_url = via_entry.get('url', '')
            if not title:
                title = via_entry.get('title', '')
            if via_entry.get('cvss', {}).get('score', 0) > cvss_score:
                cvss_score = via_entry.get('cvss', {}).get('score', 0.0)

    # Determine recommendation
    fix = pkg_data.get('fixAvailable', None)
    recommendation = ''
    if isinstance(fix, dict):
        recommendation = f\"Upgrade to {fix.get('name', pkg_name)} {fix.get('version', 'latest')}\"
    elif fix is True:
        recommendation = 'Fix available via npm audit fix'
    else:
        recommendation = 'No fix currently available'

    vulns.append({
        'name': pkg_name,
        'version': pkg_data.get('range', ''),
        'severity': severity,
        'cwe': sorted(set(cwes)),
        'cvss_score': cvss_score,
        'advisory_url': advisory_url,
        'title': title or f'Vulnerability in {pkg_name}',
        'recommendation': recommendation,
        'source': 'sca',
    })

output = {
    'vulnerabilities': vulns,
    'stats': {
        'total': len(vulns),
        'by_severity': by_severity,
    },
    'tool_used': 'npm audit',
    'package_manager': 'npm',
}
print(json.dumps(output, indent=2))
"
}

normalize_pip_audit() {
  local json_file="$1"
  python3 -c "
import json, sys

try:
    with open('$json_file', 'r') as f:
        data = json.load(f)
except Exception as e:
    print(json.dumps({'error': 'parse_failed', 'message': str(e)}))
    sys.exit(0)

vulns = []
by_severity = {}

# pip-audit outputs a JSON array of packages
if isinstance(data, list):
    entries = data
elif isinstance(data, dict):
    entries = data.get('dependencies', data.get('results', []))
else:
    entries = []

for entry in entries:
    pkg_name = entry.get('name', 'unknown')
    pkg_version = entry.get('version', '')
    for vuln in entry.get('vulns', []):
        vuln_id = vuln.get('id', '')
        description = vuln.get('description', '')
        fix_versions = vuln.get('fix_versions', [])

        # pip-audit does not provide severity natively; default to MODERATE
        severity = 'MODERATE'
        by_severity[severity] = by_severity.get(severity, 0) + 1

        recommendation = ''
        if fix_versions:
            recommendation = f'Upgrade to {fix_versions[0]}'
        else:
            recommendation = 'No fix currently available'

        vulns.append({
            'name': pkg_name,
            'version': pkg_version,
            'severity': severity,
            'cwe': [],
            'cvss_score': 0.0,
            'advisory_url': f'https://osv.dev/vulnerability/{vuln_id}' if vuln_id else '',
            'title': vuln_id or f'Vulnerability in {pkg_name}',
            'recommendation': recommendation,
            'source': 'sca',
        })

output = {
    'vulnerabilities': vulns,
    'stats': {
        'total': len(vulns),
        'by_severity': by_severity,
    },
    'tool_used': 'pip-audit',
    'package_manager': 'pip',
}
print(json.dumps(output, indent=2))
"
}

normalize_yarn_audit() {
  local json_file="$1"
  python3 -c "
import json, sys

try:
    with open('$json_file', 'r') as f:
        content = f.read().strip()
except Exception as e:
    print(json.dumps({'error': 'parse_failed', 'message': str(e)}))
    sys.exit(0)

vulns = []
by_severity = {}

# yarn audit --json outputs newline-delimited JSON
for line in content.split('\n'):
    line = line.strip()
    if not line:
        continue
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        continue

    if entry.get('type') != 'auditAdvisory':
        continue

    advisory = entry.get('data', {}).get('advisory', {})
    severity = advisory.get('severity', 'moderate').upper()
    by_severity[severity] = by_severity.get(severity, 0) + 1

    cwes = []
    cwe_val = advisory.get('cwe', '')
    if isinstance(cwe_val, str) and cwe_val.startswith('CWE-'):
        try:
            cwes.append(int(cwe_val.split('-')[1]))
        except (ValueError, IndexError):
            pass

    recommendation = advisory.get('recommendation', '')
    if not recommendation:
        patched = advisory.get('patched_versions', '')
        if patched and patched != '<0.0.0':
            recommendation = f'Upgrade to {patched}'
        else:
            recommendation = 'No fix currently available'

    vulns.append({
        'name': advisory.get('module_name', 'unknown'),
        'version': advisory.get('vulnerable_versions', ''),
        'severity': severity,
        'cwe': cwes,
        'cvss_score': float(advisory.get('cvss', {}).get('score', 0)),
        'advisory_url': advisory.get('url', ''),
        'title': advisory.get('title', ''),
        'recommendation': recommendation,
        'source': 'sca',
    })

output = {
    'vulnerabilities': vulns,
    'stats': {
        'total': len(vulns),
        'by_severity': by_severity,
    },
    'tool_used': 'yarn audit',
    'package_manager': 'yarn',
}
print(json.dumps(output, indent=2))
"
}

# Create temp file for raw output
TMPFILE="$(mktemp)"

case "$PACKAGE_MANAGER" in
  npm)
    if ! which npm >/dev/null 2>&1; then
      HANDLED_ERROR=1
      echo '{"error": "tool_not_installed", "tool": "npm", "message": "npm is not installed. Install Node.js from https://nodejs.org"}'
      exit 0
    fi
    HANDLED_ERROR=1
    # npm audit exits non-zero when vulnerabilities are found, which is expected
    (cd "$TARGET_DIR" && npm audit --json > "$TMPFILE" 2>/dev/null) || true
    normalize_npm_audit "$TMPFILE"
    rm -f "$TMPFILE"
    exit 0
    ;;

  pip)
    if ! which pip-audit >/dev/null 2>&1; then
      HANDLED_ERROR=1
      echo '{"error": "tool_not_installed", "tool": "pip-audit", "message": "pip-audit is not installed. Install with: pip install pip-audit"}'
      exit 0
    fi
    HANDLED_ERROR=1
    (cd "$TARGET_DIR" && pip-audit --format=json > "$TMPFILE" 2>/dev/null) || true
    normalize_pip_audit "$TMPFILE"
    rm -f "$TMPFILE"
    exit 0
    ;;

  yarn)
    if ! which yarn >/dev/null 2>&1; then
      HANDLED_ERROR=1
      echo '{"error": "tool_not_installed", "tool": "yarn", "message": "yarn is not installed. Install with: npm install -g yarn"}'
      exit 0
    fi
    HANDLED_ERROR=1
    (cd "$TARGET_DIR" && yarn audit --json > "$TMPFILE" 2>/dev/null) || true
    normalize_yarn_audit "$TMPFILE"
    rm -f "$TMPFILE"
    exit 0
    ;;

  bundler)
    if ! which bundle-audit >/dev/null 2>&1; then
      HANDLED_ERROR=1
      echo '{"error": "tool_not_installed", "tool": "bundle-audit", "message": "bundler-audit is not installed. Install with: gem install bundler-audit"}'
      exit 0
    fi
    HANDLED_ERROR=1
    (cd "$TARGET_DIR" && bundle-audit check --format json > "$TMPFILE" 2>/dev/null) || true
    # bundle-audit JSON is already structured with advisories
    python3 -c "
import json, sys
try:
    with open('$TMPFILE', 'r') as f:
        data = json.load(f)
except Exception as e:
    print(json.dumps({'error': 'parse_failed', 'message': str(e)}))
    sys.exit(0)

vulns = []
by_severity = {}
for result in data.get('results', []):
    advisory = result.get('advisory', {})
    severity = advisory.get('criticality', 'medium').upper()
    by_severity[severity] = by_severity.get(severity, 0) + 1
    vulns.append({
        'name': result.get('gem', {}).get('name', 'unknown'),
        'version': result.get('gem', {}).get('version', ''),
        'severity': severity,
        'cwe': [],
        'cvss_score': 0.0,
        'advisory_url': advisory.get('url', ''),
        'title': advisory.get('title', ''),
        'recommendation': 'Upgrade to patched version: ' + advisory.get('patched_versions', ['latest'])[0] if advisory.get('patched_versions') else 'No fix currently available',
        'source': 'sca',
    })
print(json.dumps({
    'vulnerabilities': vulns,
    'stats': {'total': len(vulns), 'by_severity': by_severity},
    'tool_used': 'bundle-audit',
    'package_manager': 'bundler',
}, indent=2))
"
    rm -f "$TMPFILE"
    exit 0
    ;;

  cargo)
    if ! which cargo-audit >/dev/null 2>&1 && ! cargo audit --version >/dev/null 2>&1; then
      HANDLED_ERROR=1
      echo '{"error": "tool_not_installed", "tool": "cargo-audit", "message": "cargo-audit is not installed. Install with: cargo install cargo-audit"}'
      exit 0
    fi
    HANDLED_ERROR=1
    (cd "$TARGET_DIR" && cargo audit --json > "$TMPFILE" 2>/dev/null) || true
    python3 -c "
import json, sys
try:
    with open('$TMPFILE', 'r') as f:
        data = json.load(f)
except Exception as e:
    print(json.dumps({'error': 'parse_failed', 'message': str(e)}))
    sys.exit(0)

vulns = []
by_severity = {}
for vuln in data.get('vulnerabilities', {}).get('list', []):
    advisory = vuln.get('advisory', {})
    # Map CVSS to severity
    cvss = float(advisory.get('cvss', 0) or 0)
    if cvss >= 9.0: severity = 'CRITICAL'
    elif cvss >= 7.0: severity = 'HIGH'
    elif cvss >= 4.0: severity = 'MODERATE'
    else: severity = 'LOW'
    by_severity[severity] = by_severity.get(severity, 0) + 1

    pkg = vuln.get('package', {})
    vulns.append({
        'name': pkg.get('name', 'unknown'),
        'version': pkg.get('version', ''),
        'severity': severity,
        'cwe': [],
        'cvss_score': cvss,
        'advisory_url': advisory.get('url', ''),
        'title': advisory.get('title', advisory.get('id', '')),
        'recommendation': 'Upgrade to patched version' if vuln.get('versions', {}).get('patched') else 'No fix currently available',
        'source': 'sca',
    })
print(json.dumps({
    'vulnerabilities': vulns,
    'stats': {'total': len(vulns), 'by_severity': by_severity},
    'tool_used': 'cargo audit',
    'package_manager': 'cargo',
}, indent=2))
"
    rm -f "$TMPFILE"
    exit 0
    ;;

  go)
    if ! which govulncheck >/dev/null 2>&1; then
      HANDLED_ERROR=1
      echo '{"error": "tool_not_installed", "tool": "govulncheck", "message": "govulncheck is not installed. Install with: go install golang.org/x/vuln/cmd/govulncheck@latest"}'
      exit 0
    fi
    HANDLED_ERROR=1
    (cd "$TARGET_DIR" && govulncheck -json ./... > "$TMPFILE" 2>/dev/null) || true
    python3 -c "
import json, sys
try:
    with open('$TMPFILE', 'r') as f:
        content = f.read().strip()
except Exception as e:
    print(json.dumps({'error': 'parse_failed', 'message': str(e)}))
    sys.exit(0)

vulns = []
by_severity = {}
# govulncheck JSON output is newline-delimited JSON messages
for line in content.split('\n'):
    line = line.strip()
    if not line:
        continue
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        continue
    osv = entry.get('osv', None)
    if osv is None:
        continue
    severity = 'MODERATE'
    by_severity[severity] = by_severity.get(severity, 0) + 1
    affected_pkg = ''
    affected_ver = ''
    for affected in osv.get('affected', []):
        pkg = affected.get('package', {})
        affected_pkg = pkg.get('name', '')
        if affected.get('ranges'):
            for r in affected['ranges']:
                for ev in r.get('events', []):
                    if 'introduced' in ev:
                        affected_ver = ev['introduced']
        break
    vulns.append({
        'name': affected_pkg,
        'version': affected_ver,
        'severity': severity,
        'cwe': [],
        'cvss_score': 0.0,
        'advisory_url': 'https://pkg.go.dev/vuln/' + osv.get('id', ''),
        'title': osv.get('summary', osv.get('id', '')),
        'recommendation': 'Upgrade affected module',
        'source': 'sca',
    })
print(json.dumps({
    'vulnerabilities': vulns,
    'stats': {'total': len(vulns), 'by_severity': by_severity},
    'tool_used': 'govulncheck',
    'package_manager': 'go',
}, indent=2))
"
    rm -f "$TMPFILE"
    exit 0
    ;;

  nuget)
    if ! which dotnet >/dev/null 2>&1; then
      HANDLED_ERROR=1
      echo '{"error": "tool_not_installed", "tool": "dotnet", "message": "dotnet CLI is not installed. See https://dotnet.microsoft.com/download"}'
      exit 0
    fi
    HANDLED_ERROR=1
    (cd "$TARGET_DIR" && dotnet list package --vulnerable --format json > "$TMPFILE" 2>/dev/null) || true
    # dotnet list --format json may not be available in older versions; fall back to text parsing
    if python3 -c "import json; json.load(open('$TMPFILE'))" 2>/dev/null; then
      python3 -c "
import json, sys
try:
    with open('$TMPFILE', 'r') as f:
        data = json.load(f)
except Exception as e:
    print(json.dumps({'error': 'parse_failed', 'message': str(e)}))
    sys.exit(0)

vulns = []
by_severity = {}
for project in data.get('projects', []):
    for fw in project.get('frameworks', []):
        for pkg in fw.get('topLevelPackages', []) + fw.get('transitivePackages', []):
            for vuln in pkg.get('vulnerabilities', []):
                severity = vuln.get('severity', 'Moderate').upper()
                by_severity[severity] = by_severity.get(severity, 0) + 1
                vulns.append({
                    'name': pkg.get('id', 'unknown'),
                    'version': pkg.get('resolvedVersion', ''),
                    'severity': severity,
                    'cwe': [],
                    'cvss_score': 0.0,
                    'advisory_url': vuln.get('advisoryurl', ''),
                    'title': vuln.get('advisoryurl', '').split('/')[-1] if vuln.get('advisoryurl') else '',
                    'recommendation': 'Upgrade package',
                    'source': 'sca',
                })
print(json.dumps({
    'vulnerabilities': vulns,
    'stats': {'total': len(vulns), 'by_severity': by_severity},
    'tool_used': 'dotnet list package --vulnerable',
    'package_manager': 'nuget',
}, indent=2))
"
    else
      echo '{"error": "parse_failed", "tool": "dotnet", "message": "dotnet list package --format json not supported in this version. Update .NET SDK or use OWASP Dependency-Check."}'
    fi
    rm -f "$TMPFILE"
    exit 0
    ;;

  composer)
    if ! which composer >/dev/null 2>&1; then
      HANDLED_ERROR=1
      echo '{"error": "tool_not_installed", "tool": "composer", "message": "Composer is not installed. See https://getcomposer.org/download/"}'
      exit 0
    fi
    HANDLED_ERROR=1
    (cd "$TARGET_DIR" && composer audit --format=json > "$TMPFILE" 2>/dev/null) || true
    python3 -c "
import json, sys
try:
    with open('$TMPFILE', 'r') as f:
        data = json.load(f)
except Exception as e:
    print(json.dumps({'error': 'parse_failed', 'message': str(e)}))
    sys.exit(0)

vulns = []
by_severity = {}
for advisory_id, advisory_list in data.get('advisories', {}).items():
    for advisory in advisory_list:
        severity = 'MODERATE'
        cve = advisory.get('cve', '')
        if cve:
            severity = 'HIGH'
        by_severity[severity] = by_severity.get(severity, 0) + 1
        vulns.append({
            'name': advisory.get('packageName', advisory_id),
            'version': advisory.get('affectedVersions', ''),
            'severity': severity,
            'cwe': [],
            'cvss_score': 0.0,
            'advisory_url': advisory.get('link', ''),
            'title': advisory.get('title', cve or advisory_id),
            'recommendation': 'Upgrade package',
            'source': 'sca',
        })
print(json.dumps({
    'vulnerabilities': vulns,
    'stats': {'total': len(vulns), 'by_severity': by_severity},
    'tool_used': 'composer audit',
    'package_manager': 'composer',
}, indent=2))
"
    rm -f "$TMPFILE"
    exit 0
    ;;

  *)
    # Fallback: dependency-check CLI
    if ! which dependency-check >/dev/null 2>&1; then
      HANDLED_ERROR=1
      echo "{\"error\": \"tool_not_installed\", \"tool\": \"sca\", \"message\": \"No SCA tool found for package manager: $PACKAGE_MANAGER. Install OWASP Dependency-Check from https://owasp.org/www-project-dependency-check/\"}"
      exit 0
    fi
    HANDLED_ERROR=1
    TMPDIR_OUT="$(mktemp -d)"
    DC_EXIT=0
    dependency-check --scan "$TARGET_DIR" --format JSON --out "$TMPDIR_OUT" 2>/dev/null || DC_EXIT=$?
    if [[ $DC_EXIT -ne 0 ]]; then
      echo "{\"error\": \"scan_failed\", \"tool\": \"dependency-check\", \"message\": \"dependency-check exited with code $DC_EXIT\", \"exit_code\": $DC_EXIT}"
      exit 0
    fi
    if [[ -f "$TMPDIR_OUT/dependency-check-report.json" ]]; then
      cat "$TMPDIR_OUT/dependency-check-report.json"
    else
      echo '{"error": "scan_failed", "tool": "dependency-check", "message": "No report file generated"}'
    fi
    rm -rf "$TMPDIR_OUT"
    exit 0
    ;;
esac

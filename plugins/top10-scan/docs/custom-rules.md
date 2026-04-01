# Writing Custom Opengrep Rules

This guide covers how to write custom Opengrep rules to fill OWASP Top 10 coverage gaps specific to your codebase or framework.

## Overview

Opengrep uses YAML-based rule definitions for static analysis. Custom rules extend the built-in rule set to catch patterns that the default rules miss. Each rule should include CWE metadata so it can be automatically mapped to an OWASP Top 10 category.

## Rule Format

Opengrep rules follow the Semgrep-compatible YAML format:

```yaml
rules:
  - id: rule-unique-identifier
    patterns:
      - pattern: |
          $FUNC(..., $USER_INPUT, ...)
    message: >
      Description of the vulnerability and recommended fix.
    metadata:
      cwe:
        - "CWE-89: Improper Neutralization of Special Elements used in an SQL Command"
      owasp:
        - "A03:2021 - Injection"
      confidence: HIGH
      impact: HIGH
    languages:
      - javascript
    severity: ERROR
```

### Required Fields

- **id**: Unique identifier for the rule. Use kebab-case. Prefix with your org or project name to avoid collisions (e.g., `ordovera-sql-concat`).
- **patterns** or **pattern**: The code pattern to match. Uses Opengrep's pattern syntax with metavariables (prefixed with `$`).
- **message**: Human-readable description of the finding. Include the vulnerability, its impact, and a recommended fix.
- **languages**: List of languages the rule applies to.
- **severity**: One of `ERROR`, `WARNING`, or `INFO`.

### Pattern Syntax

Opengrep patterns support:

- **Metavariables**: `$VAR` matches any expression, `$...ARGS` matches zero or more arguments.
- **Ellipsis**: `...` matches any sequence of statements or arguments.
- **String matching**: Literal strings match exactly. Use `"..."` for any string.

Examples:

```yaml
# Match any call to a dangerous dynamic execution function with any argument
- pattern: vm.runInThisContext($X)

# Match SQL string concatenation
- pattern: $QUERY = "..." + $INPUT

# Match missing auth decorator (absence pattern)
- patterns:
    - pattern: |
        def $FUNC(request, ...):
            ...
    - pattern-not-inside: |
        @login_required
        def $FUNC(request, ...):
            ...
```

## Adding CWE Metadata

CWE (Common Weakness Enumeration) metadata enables automatic mapping from rule findings to OWASP Top 10 categories. The mapping is based on the official OWASP Top 10 CWE lists.

### CWE to OWASP Mapping (Common Examples)

| CWE | OWASP Category |
| --- | -------------- |
| CWE-89 (SQL Injection) | A03 - Injection |
| CWE-79 (XSS) | A03 - Injection |
| CWE-78 (OS Command Injection) | A03 - Injection |
| CWE-287 (Improper Authentication) | A07 - Identification and Authentication Failures |
| CWE-306 (Missing Auth for Critical Function) | A01 - Broken Access Control |
| CWE-327 (Use of Broken Crypto Algorithm) | A02 - Cryptographic Failures |
| CWE-502 (Deserialization of Untrusted Data) | A08 - Software and Data Integrity Failures |
| CWE-918 (SSRF) | A10 - Server-Side Request Forgery |

### Metadata Block

```yaml
metadata:
  cwe:
    - "CWE-89: Improper Neutralization of Special Elements used in an SQL Command"
  owasp:
    - "A03:2021 - Injection"
  confidence: HIGH
  impact: HIGH
  references:
    - https://cwe.mitre.org/data/definitions/89.html
```

- **cwe**: List of CWE identifiers with descriptions. This is the primary field used for OWASP mapping.
- **owasp**: Explicit OWASP category mapping. Used as a fallback if CWE-based mapping is unavailable.
- **confidence**: How likely the finding is a true positive. One of `HIGH`, `MEDIUM`, `LOW`.
- **impact**: Severity of the vulnerability if exploited. One of `HIGH`, `MEDIUM`, `LOW`.

## Mapping Rules to OWASP Categories

The scan engine maps findings to OWASP categories using this priority:

1. **CWE-based mapping**: The CWE ID from the rule metadata is looked up in the OWASP Top 10 CWE mapping table (stored in `top10.json`). This is the preferred method because it automatically adapts when OWASP updates their category definitions.

2. **Explicit owasp field**: If no CWE match is found, the `owasp` metadata field is used directly.

3. **Unmapped findings**: Findings without CWE or OWASP metadata are reported in a separate "unmapped" section of the results for manual triage.

To ensure your rules are properly mapped, always include at least one CWE identifier in the metadata.

## Testing Custom Rules

### 1. Test Against a Single File

```bash
opengrep --config path/to/rule.yml path/to/test-file.js
```

### 2. Test Against a Fixture

Run the rule against an existing test fixture to verify it catches the intended vulnerability:

```bash
opengrep --config path/to/rule.yml test-fixtures/vulnerable-nextjs/
```

### 3. Verify OWASP Mapping

After running the scan, check the results JSON to confirm the finding is mapped to the expected OWASP category:

```bash
python run-scan.py --rules path/to/rule.yml test-fixtures/vulnerable-express/
# Check output/results.json for correct category assignment
```

### 4. Check for False Positives

Run the rule against a known-clean codebase or the non-vulnerable parts of the test fixtures. The rule should produce zero findings on clean code.

### 5. Add to Expected Results

If the rule targets a vulnerability in an existing test fixture, update the corresponding baseline JSON in `expected-results/` to include the new expected finding.

## Example: Custom Rule for Hardcoded JWT Secret

```yaml
rules:
  - id: ordovera-hardcoded-jwt-secret
    patterns:
      - pattern: |
          jwt.sign($PAYLOAD, "...", ...)
    message: >
      JWT signed with a hardcoded secret string. Use an environment variable
      or secret management service for the signing key.
    metadata:
      cwe:
        - "CWE-798: Use of Hard-coded Credentials"
      owasp:
        - "A07:2021 - Identification and Authentication Failures"
      confidence: HIGH
      impact: HIGH
    languages:
      - javascript
      - typescript
    severity: ERROR
```

## File Organization

Place custom rules in the `rules/` directory, organized by language:

```text
rules/
  custom/
    your-org-auth-rules.yml
    your-org-injection-rules.yml
  javascript/
    built-in-rules.yml
  python/
    built-in-rules.yml
```

Rules in `rules/custom/` are loaded alongside built-in rules during every scan.

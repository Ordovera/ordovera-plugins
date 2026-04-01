# Adding Framework Support

This guide covers how to add detection and rule mappings for a new framework to the top10-scan plugin.

## Overview

Framework support consists of four components:

1. Framework detection markers in detect-framework.py
2. Framework-specific hints in review-prompts.json
3. Language mappings for Opengrep rule selection
4. Verification against test fixtures

## Step 1: Add Detection Markers

Edit `detect-framework.py` to add file-based markers that identify the new framework.

Each framework is detected by the presence of specific files or patterns in `package.json`, `requirements.txt`, or equivalent dependency manifests.

### Marker Structure

```python
FRAMEWORK_MARKERS = {
    "framework-name": {
        "files": ["distinctive-config-file.ext"],
        "dependencies": ["framework-package-name"],
        "language": "language-name",
    },
}
```

### Fields

- **files**: List of file paths whose presence indicates the framework (e.g., `next.config.js` for Next.js, `manage.py` for Django).
- **dependencies**: Package names to look for in the dependency manifest (package.json, requirements.txt, Gemfile, etc.).
- **language**: The programming language used by the framework. This drives Opengrep rule selection.

### Example: Adding Fastify Support

```python
FRAMEWORK_MARKERS = {
    # ... existing entries ...
    "fastify": {
        "files": [],
        "dependencies": ["fastify"],
        "language": "javascript",
    },
}
```

The detection logic checks files first, then falls back to dependency scanning. If both `files` and `dependencies` are provided, either match is sufficient.

## Step 2: Add Framework Hints to review-prompts.json

Edit `review-prompts.json` to add framework-specific review guidance. This tells the design review pass what security patterns and anti-patterns to look for.

### Hint Structure

```json
{
  "framework_hints": {
    "framework-name": {
      "auth_patterns": ["Description of how auth typically works in this framework"],
      "common_misconfigurations": ["Known security pitfalls specific to this framework"],
      "security_middleware": ["Names of security middleware or packages to check for"]
    }
  }
}
```

### Example: Adding Fastify Hints

```json
{
  "framework_hints": {
    "fastify": {
      "auth_patterns": [
        "Check for @fastify/auth or fastify-jwt plugin registration",
        "Verify preHandler hooks enforce authentication on protected routes"
      ],
      "common_misconfigurations": [
        "Missing @fastify/helmet for security headers",
        "Missing @fastify/rate-limit on authentication endpoints",
        "trustProxy not configured when behind a reverse proxy"
      ],
      "security_middleware": [
        "@fastify/helmet",
        "@fastify/cors",
        "@fastify/rate-limit",
        "@fastify/csrf-protection"
      ]
    }
  }
}
```

## Step 3: Add Language Mappings for Opengrep Rules

Opengrep rules are organized by language. The language field in the framework marker determines which rule sets are applied.

If the framework uses a language already supported (javascript, python, java, go, ruby, etc.), no additional mapping is needed.

If the framework uses a new language:

1. Add rule files to the `rules/` directory following the naming convention `rules/{language}/`.
2. Update the language-to-rules mapping in the scan configuration.
3. Ensure CWE metadata is present in each rule for automatic OWASP category mapping.

### Rule Directory Structure

```text
rules/
  javascript/
    injection.yml
    auth.yml
  python/
    injection.yml
    auth.yml
  new-language/
    injection.yml
    auth.yml
```

## Step 4: Test the New Framework

1. Create a minimal test fixture under `test-fixtures/vulnerable-{framework}/` with intentional vulnerabilities covering the OWASP categories relevant to the framework.

2. Create an expected results file at `expected-results/{framework}-baseline.json` following the structure of existing baselines.

3. Run the scan against the fixture:

```bash
# Run scan against the new fixture
python run-scan.py test-fixtures/vulnerable-{framework}/

# Compare results against the baseline
python compare-results.py \
  expected-results/{framework}-baseline.json \
  output/results.json
```

1. Verify:
   - The framework is correctly detected in the scan output.
   - All `required_categories` from the baseline are present in results.
   - The total finding count meets or exceeds `minimum_finding_count`.
   - No false positives from framework-specific patterns (e.g., framework boilerplate misidentified as a vulnerability).

## Checklist

Before submitting a new framework:

- [ ] Detection markers added to detect-framework.py
- [ ] Framework hints added to review-prompts.json
- [ ] Language mapping verified (existing or new rules added)
- [ ] Test fixture created with documented vulnerabilities
- [ ] Expected results baseline created
- [ ] Scan passes against the fixture with all required categories found

# Security Audit Report

**Project:** {{project_name}}
**Framework:** {{framework}}
**Date:** {{date}}
**OWASP Version:** Top 10:{{owasp_version}}

## Executive Summary

{{executive_summary}}

**Total Findings:** {{total_findings}}

| Severity | Count |
| -------- | ----- |
| Critical | {{critical_count}} |
| High | {{high_count}} |
| Medium | {{medium_count}} |
| Low | {{low_count}} |
| Informational | {{info_count}} |

## Tool Coverage

| Layer | Tool | Status |
| ----- | ---- | ------ |
| SAST | Opengrep | {{sast_status}} |
| SCA | {{sca_tool}} | {{sca_status}} |
| DAST | ZAP | {{dast_status}} |
| Design Review | Claude | {{design_status}} |

## Findings by OWASP Category

{{#each categories}}

### {{category_id}}: {{category_name}}

{{#if findings}}
{{#each findings}}
{{> finding}}
{{/each}}
{{else}}
No findings in this category.
{{/if}}

{{/each}}

## Attack Surface

{{attack_surface}}

## Methodology

This audit was performed using a multi-layer approach:

1. **Framework Detection** - Automated identification of project technology stack
2. **Attack Surface Discovery** - Mapping of endpoints, authentication, and integrations
3. **SAST** - Static analysis using Opengrep with CWE-mapped rules
4. **SCA** - Dependency vulnerability scanning
5. **DAST** - Dynamic testing of running application (when URL provided)
6. **Design Review** - Claude analysis of architecture and security patterns
7. **Synthesis** - Cross-layer correlation, deduplication, and severity scoring

Severity scoring uses a CVSS-inspired 5-factor model (attack vector, exposure, data sensitivity, exploitability, impact) with composite scoring range 5-15.

# Changelog

## 1.0.0

- Initial release with OWASP Top 10:2025 mapping
- Seven-layer security audit: framework detection, attack surface, SAST, SCA, DAST, design review, synthesis
- Opengrep SAST integration with CWE-based rule selection
- ZAP DAST integration with framework-aware configuration
- npm audit / pip-audit / Dependency-Check SCA integration
- Graceful degradation when external tools are unavailable
- CWE-to-OWASP category mapping for automatic version migration
- CVSS-inspired 5-factor severity model
- Dual output: Markdown report and SARIF 2.1.0
- Sub-command routing: full, sast, dast, sca, surface
- Test fixtures with intentional vulnerabilities for Next.js, Express, and Django

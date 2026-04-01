# Vulnerable Express Test Fixture

Minimal Express application with intentional OWASP Top 10 vulnerabilities for testing the top10-scan plugin.

WARNING: This is a deliberately vulnerable application. Never deploy or run in production.

## Planted Vulnerabilities

### A02 - Cryptographic Failures

- **server.js**: No helmet middleware. Serves over HTTP. CORS set to '*' allowing all origins.
- **lib/crypto.js**: Uses MD5 for password hashing instead of bcrypt/scrypt/argon2.

### A03 - Vulnerable and Outdated Components

- **package.json**: lodash 4.17.15 with known prototype pollution vulnerability (CVE-2020-8203).

### A05 - Injection

- **server.js**: Dynamic code execution with user-controlled input. Raw SQL query built via string concatenation.

### A08 - Software and Data Integrity Failures

- **server.js**: Serves HTML without Subresource Integrity (SRI) on external script tags.

### A10 - Server-Side Request Forgery / Logging and Monitoring Failures

- **server.js**: Empty catch blocks swallow errors silently. Unvalidated URL fetch (SSRF) - user-provided URL passed directly to http.get without allowlist validation.

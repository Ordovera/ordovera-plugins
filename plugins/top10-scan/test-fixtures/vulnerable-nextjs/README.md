# Vulnerable Next.js Test Fixture

Minimal Next.js application with intentional OWASP Top 10 vulnerabilities for testing the top10-scan plugin.

WARNING: This is a deliberately vulnerable application. Never deploy or run in production.

## Planted Vulnerabilities

### A01 - Broken Access Control

- **app/api/users/route.ts**: No authentication check on user endpoint. IDOR vulnerability - fetches user by ID from query parameter without ownership verification.
- **app/api/admin/route.ts**: No authentication middleware on admin endpoint. Any unauthenticated request can access admin functionality.

### A03 - Vulnerable and Outdated Components

- **package.json**: lodash 4.17.15 with known prototype pollution vulnerability (CVE-2020-8203).

### A05 - Security Misconfiguration / Injection

- **app/api/users/route.ts**: SQL query built via string concatenation instead of parameterized queries.
- **app/api/admin/route.ts**: Unsanitized HTML rendering using dangerous innerHTML injection with user-controlled input.

### A07 - Identification and Authentication Failures

- **lib/auth.ts**: JWT signed with HS256 using a hardcoded short secret ("secret123"). No token expiration configured.

### A10 - Server-Side Request Forgery / Logging and Monitoring Failures

- **app/api/users/route.ts**: Fail-open catch block returns HTTP 200 on error and leaks internal error details in the response body.

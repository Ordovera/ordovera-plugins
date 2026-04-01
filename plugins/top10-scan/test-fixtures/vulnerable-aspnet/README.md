# Vulnerable ASP.NET Test Fixture

Minimal ASP.NET Core Web API with intentional OWASP Top 10 vulnerabilities for testing the top10-scan plugin.

WARNING: This is a deliberately vulnerable application. Never deploy or run in production.

## Planted Vulnerabilities

### A01 - Broken Access Control

- **Controllers/AdminController.cs**: No [Authorize] attribute on admin endpoints. User data accessible without ownership check.

### A02 - Security Misconfiguration

- **Program.cs**: Developer exception page enabled unconditionally. CORS allows all origins. HTTPS redirection missing.
- **appsettings.json**: Connection string with hardcoded credentials. Detailed errors enabled.

### A05 - Injection

- **Controllers/UsersController.cs**: Raw SQL via string interpolation with ExecuteSqlRaw. User input rendered without encoding.

### A08 - Data Integrity Failures

- **Controllers/WebhookController.cs**: Webhook endpoint accepts payloads without signature verification. No model binding validation.

### A10 - Mishandling of Exceptional Conditions

- **Controllers/UsersController.cs**: Raw exception messages returned to client. Missing async cancellation handling. No timeout on HttpClient calls.

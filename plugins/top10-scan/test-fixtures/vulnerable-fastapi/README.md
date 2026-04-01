# Vulnerable FastAPI Test Fixture

Minimal FastAPI application with intentional OWASP Top 10 vulnerabilities for testing the top10-scan plugin.

WARNING: This is a deliberately vulnerable application. Never deploy or run in production.

## Planted Vulnerabilities

### A01 - Broken Access Control

- **app/main.py**: Admin routes have no authentication dependency. User endpoints lack ownership verification.

### A02 - Security Misconfiguration

- **app/main.py**: CORS allows all origins. OpenAPI docs exposed without auth. Debug mode enabled.

### A05 - Injection

- **app/routes/users.py**: Raw SQL via f-string interpolation instead of SQLAlchemy parameterized queries. Template rendered with user input without escaping.

### A07 - Authentication Failures

- **app/auth.py**: JWT with hardcoded weak secret, no expiration. Password stored with MD5 instead of bcrypt/argon2.

### A10 - Mishandling of Exceptional Conditions

- **app/routes/users.py**: Bare except blocks that swallow errors. Database errors leaked in responses. No timeout on external HTTP calls.

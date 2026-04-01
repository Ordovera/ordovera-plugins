# Vulnerable Rust Test Fixture

Minimal Rust web application (Actix-web) with intentional OWASP Top 10 vulnerabilities for testing the top10-scan plugin.

WARNING: This is a deliberately vulnerable application. Never deploy or run in production.

## Planted Vulnerabilities

### A01 - Broken Access Control

- **src/main.rs**: Admin endpoints have no authentication middleware. User lookup by ID without ownership verification.

### A04 - Cryptographic Failures

- **src/auth.rs**: Hardcoded JWT secret. HMAC-SHA256 with a weak key. No token expiration set.

### A05 - Injection

- **src/handlers.rs**: SQL query built with format!() string interpolation from user input instead of parameterized queries.

### A06 - Insecure Design

- **src/handlers.rs**: No rate limiting on login endpoint. Password reset token is predictable (timestamp-based).

### A10 - Mishandling of Exceptional Conditions

- **src/handlers.rs**: unwrap() on user input parsing without error handling. Panics leak stack trace in debug mode. Error responses expose internal database details.

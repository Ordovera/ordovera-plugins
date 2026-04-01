# Vulnerable PHP/Laravel Test Fixture

Minimal PHP application with intentional OWASP Top 10 vulnerabilities for testing the top10-scan plugin.

WARNING: This is a deliberately vulnerable application. Never deploy or run in production.

## Planted Vulnerabilities

### A01 - Broken Access Control

- **routes/web.php**: Admin routes lack auth middleware. Direct object reference on user profile endpoint without ownership check.

### A02 - Security Misconfiguration

- **config/app.php**: APP_DEBUG set to true. APP_KEY left as default placeholder.
- **.env.example**: Database credentials hardcoded with common defaults.

### A04 - Cryptographic Failures

- **app/Http/Controllers/AuthController.php**: Passwords stored using SHA1 instead of bcrypt. Session tokens generated with weak randomness (mt_rand).

### A05 - Injection

- **app/Http/Controllers/UserController.php**: Raw SQL query built with string concatenation from request input. Unsanitized output rendered with {!! !!} Blade syntax.

### A09 - Security Logging and Monitoring Failures

- **app/Http/Controllers/AuthController.php**: No logging of failed login attempts. No audit trail for admin actions.

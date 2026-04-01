# Vulnerable Django Test Fixture

Minimal Django application with intentional OWASP Top 10 vulnerabilities for testing the top10-scan plugin.

WARNING: This is a deliberately vulnerable application. Never deploy or run in production.

## Planted Vulnerabilities

### A01 - Broken Access Control

- **myapp/views.py**: Views missing @login_required decorator. Sensitive data accessible without authentication.

### A02 - Cryptographic Failures

- **myapp/settings.py**: DEBUG=True in production-like config. ALLOWED_HOSTS set to ['*']. SECRET_KEY hardcoded in source code.

### A06 - Vulnerable and Outdated Components

- **myapp/views.py**: No rate limiting on the login endpoint. Allows unlimited brute-force attempts.

### A07 - Identification and Authentication Failures

- **myapp/views.py**: Checks for default admin credentials (admin/admin) and allows login with them.

### A09 - Security Logging and Monitoring Failures

- **myapp/views.py**: No logging of failed authentication attempts. No audit trail for sensitive operations.

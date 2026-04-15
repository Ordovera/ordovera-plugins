"""Authentication module for the test server."""
from functools import wraps


def require_scope(scope: str):
    """Decorator to enforce OAuth scope on a handler."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            token = get_bearer_token()
            if scope not in token.scopes:
                raise PermissionError(f"Missing scope: {scope}")
            return await func(*args, **kwargs)
        return wrapper
    return decorator


def get_bearer_token():
    """Extract Bearer token from the request context."""
    pass


API_KEY_HEADER = "X-API-Key"

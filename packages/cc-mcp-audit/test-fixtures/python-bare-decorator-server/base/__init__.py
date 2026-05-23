"""Project base module defining a custom @tool decorator (Pattern D)."""

from functools import wraps
from mcp.server import Server

TOOLS = {}


def tool(name: str, description: str = "", **kwargs):
    """Register a tool into the TOOLS dict."""
    def decorator(func):
        TOOLS[name] = {"name": name, "description": description, "fn": func}
        @wraps(func)
        def wrapper(*a, **kw):
            return func(*a, **kw)
        return wrapper
    return decorator

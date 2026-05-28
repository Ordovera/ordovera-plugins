"""Pattern O1 fixture: bare @<x>.tool decorator with no parentheses.

Mirrors semantic-model-style servers that apply the registration decorator
without calling it, e.g. `@mcp.tool` directly above the function. The tool
name is the decorated function's name; the description is its docstring.
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("semantic-model")


@mcp.tool
def get_model_schema(model: str) -> dict:
    """Return the schema for a semantic model."""
    return {"model": model}


@mcp.tool
def list_dimensions(model: str) -> list:
    """List the dimensions available on a model."""
    return []


@mcp.tool
def create_metric(name: str, expr: str) -> dict:
    """Create a new metric in the semantic layer."""
    return {"name": name, "expr": expr}

"""Pattern Cr fixture: low-level @list_tools handler that delegates to a
runtime registry.

Mirrors kazkozdev/mcp-search-server: tools are registered via a registry and
the @list_tools() handler iterates over registry entries with Tool(name=tool.name).
The deterministic extractor cannot resolve the variable name, so it falls back
to scanning tools/__init__.py's __all__ for tool names.
"""

from typing import List

from mcp.server import Server
from mcp.types import Tool

from .registry import get_global_registry, register_all_tools

app = Server("registry-test")


@app.list_tools()
async def list_tools() -> List[Tool]:
    registry = get_global_registry()
    if registry.is_empty():
        register_all_tools(app)
    return [
        Tool(
            name=tool.name,
            description=tool.description,
            inputSchema=tool.metadata.input_schema or {},
        )
        for tool in registry.all()
    ]

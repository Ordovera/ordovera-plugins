"""Thin Python wrapper around mcp_core tool bundle."""
from mcp.server import FastMCP
from mcp_core.tools import get_all_tools

app = FastMCP("python-wrapper")

for tool in get_all_tools():
    app.add_tool(tool.name, tool.handler)

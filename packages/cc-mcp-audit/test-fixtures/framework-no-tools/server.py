"""Server that imports MCP framework but registers tools dynamically."""
from mcp import Server
from mcp.server import FastMCP

app = FastMCP("dynamic-server")

# Tools registered dynamically at runtime -- not detectable by regex
for name, fn in tool_registry.items():
    app.add_tool(name, fn)

"""MCP server using low-level @list_tools() handler (Pattern C).

Mirrors jaspertvdm/mcp-server-jis: tools registered as multi-line Tool()
constructors inside the body of a @server.list_tools() handler.
"""

from typing import Any, List
from mcp.server import Server
from mcp.types import Tool, TextContent

server = Server("list-tools-handler-test")


@server.list_tools()
async def list_tools() -> List[Tool]:
    """List available identity verification tools."""
    return [
        Tool(
            name="jis_whoami",
            description="Show your current JIS identity.",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="jis_verify",
            description="Verify a jis: identifier.",
            inputSchema={
                "type": "object",
                "properties": {"did": {"type": "string"}},
                "required": ["did"],
            },
        ),
        Tool(
            name="jis_delete_identity",
            description="Permanently delete your JIS identity record.",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any] | None) -> List[TextContent]:
    """Dispatcher -- not a tool itself."""
    return [TextContent(type="text", text=f"called {name}")]

"""MCP server with stacked decorators between @tool and def."""
from mcp.server import FastMCP

mcp = FastMCP("stacked-server")


@mcp.tool()
@log_usage(function_name="search", log_type="mcp_tool")
async def search_items(query: str) -> list:
    """Search for items matching the query"""
    pass


@mcp.tool()
@log_usage(function_name="delete", log_type="mcp_tool")
@require_auth
async def delete_item(item_id: str) -> list:
    """Delete an item by its ID"""
    pass


@mcp.tool(
    name="custom_create",
    description="Create a new resource with custom name"
)
@log_usage(function_name="create", log_type="mcp_tool")
async def create_resource(data: str) -> list:
    """Create a new resource"""
    pass


@mcp.tool()
async def get_status() -> list:
    """Get current system status"""
    pass

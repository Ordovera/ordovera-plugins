"""Minimal MCP server fixture with mixed tool patterns."""
import logging
from mcp import Server

logger = logging.getLogger(__name__)

app = Server("test-server")


@app.tool()
async def list_items(query: str) -> list:
    """List all items matching the query."""
    logger.info(f"Listing items for query: {query}")
    return []


@app.tool("create_item")
async def create_item(name: str, data: dict) -> dict:
    """Create a new item in the database."""
    logger.info(f"Creating item: {name}")
    return {"id": 1, "name": name}


@app.tool(name="delete_item")
async def remove_item(item_id: int) -> bool:
    """Delete an item by ID. This is a destructive operation."""
    logger.warning(f"Deleting item: {item_id}")
    return True


@app.tool()
async def get_status() -> dict:
    """Get the current server status."""
    return {"status": "ok"}


# Registration-style tool
app.tool("execute_query", description="Execute a read-only SQL query", handler=run_query)

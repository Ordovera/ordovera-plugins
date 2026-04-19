"""FastMCP server fixture with multi-line decorators and dynamic registration."""
import logging
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import Field

logger = logging.getLogger(__name__)

mcp = FastMCP("test-fastmcp-server")


@mcp.tool(
    description="List all database schemas",
    annotations=ToolAnnotations(
        title="List Schemas",
        readOnlyHint=True,
    ),
)
async def list_schemas(
    include_system: bool = Field(description="Include system schemas", default=False),
):
    """List all schemas in the database."""
    return []


@mcp.tool(
    description="Get detailed information about a database object",
    annotations=ToolAnnotations(
        title="Get Object Details",
        readOnlyHint=True,
    ),
)
async def get_object_details(
    schema: str = Field(description="Schema name"),
    name: str = Field(description="Object name"),
):
    """Get details for a specific database object."""
    return {}


@mcp.tool(
    name="analyze_health",
    description="Analyze database health metrics",
    annotations=ToolAnnotations(
        title="Analyze Health",
        readOnlyHint=True,
    ),
)
async def analyze_db_health():
    """Run health analysis."""
    return {}


@mcp.tool(
    description="Delete a table from the database",
    annotations=ToolAnnotations(
        title="Drop Table",
        destructiveHint=True,
    ),
)
async def drop_table(
    schema: str = Field(description="Schema name"),
    table: str = Field(description="Table name"),
):
    """Drop a table. This is destructive."""
    pass


@mcp.tool()
async def get_version():
    """Get the server version."""
    return "1.0.0"


# Dynamic registration -- tool defined as a plain function
async def execute_sql(
    sql: str = Field(description="SQL to run"),
):
    """Execute a SQL query against the database."""
    return []


# Conditionally registered at startup
mcp.add_tool(
    execute_sql,
    description="Execute any SQL query",
    annotations=ToolAnnotations(
        title="Execute SQL",
        destructiveHint=True,
    ),
)

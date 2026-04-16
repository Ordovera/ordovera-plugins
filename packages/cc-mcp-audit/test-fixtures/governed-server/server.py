"""Well-governed MCP server with rate limiting and least privilege."""
from mcp import Server
from slowapi import Limiter

app = Server("governed-server")
limiter = Limiter(key_func=get_remote_address)

TOOL_PERMISSIONS = {
    "read_data": ["read:data"],
    "write_data": ["write:data"],
    "admin_reset": ["admin:full"],
}

required_scopes = ["read:data"]
allowed_operations = ["select", "describe"]


@app.tool()
@limiter.limit("10/minute")
async def read_data(query: str) -> dict:
    """Read data with rate limiting and scope check."""
    check_scopes(required_scopes)
    return {"rows": []}


@app.tool()
@limiter.limit("5/minute")
async def write_data(record: dict) -> dict:
    """Write a record. Requires write:data scope."""
    check_scopes(["write:data"])
    return {"id": 1}


@app.tool()
async def admin_reset(target: str) -> dict:
    """Reset system state. Restricted to admin scope."""
    check_scopes(["admin:full"])
    return {"reset": True}

"""MCP server with tool definitions and test files."""
from mcp.server import FastMCP

app = FastMCP("tested-server")

@app.tool()
async def list_users():
    """List all users in the system"""
    pass

@app.tool()
async def create_user():
    """Create a new user account"""
    pass

@app.tool()
async def delete_user():
    """Delete a user account"""
    pass

@app.tool()
async def get_status():
    """Get system status"""
    pass

@app.tool()
async def update_settings():
    """Update application settings"""
    pass

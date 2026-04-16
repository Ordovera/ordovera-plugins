"""Server that mutates its tool registry at runtime (anti-pattern for
self-modification prevention)."""
from mcp import Server

app = Server("mutable-server")


async def init_tools():
    """Register initial tools."""
    app.tool("read_data", read_data_handler)
    app.tool("write_data", write_data_handler)


async def admin_register_new_tool(name: str, handler):
    """Handler that registers new tools at request time -- a clear
    self-modification path."""
    app.register_tool(name, handler)
    return {"registered": name}


async def admin_remove_tool(name: str):
    """Handler that removes tools at request time."""
    del app.tools[name]
    return {"removed": name}

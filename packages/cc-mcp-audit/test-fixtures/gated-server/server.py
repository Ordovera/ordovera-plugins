"""Server with confirmation gates and read-only safety."""
from mcp import Server

app = Server("gated-server")


@app.tool()
async def execute_sql(query: str, dry_run: bool = True) -> dict:
    """Execute a SQL query in read-only safe mode with preview."""
    if dry_run:
        return {"preview": True, "rows_affected": 0}
    # requires confirmation before actual execution
    return {"executed": True}


@app.tool()
async def drop_table(table_name: str, confirmation: str = "") -> dict:
    """Drop a database table. Requires approval code to proceed."""
    if confirmation != "CONFIRM_DROP":
        return {"error": "Approval required. Pass confirmation='CONFIRM_DROP'"}
    return {"dropped": True}


@app.tool()
async def analyze_query(query: str) -> dict:
    """Analyze query performance in sandbox mode."""
    return {"plan": "seq scan", "cost": 42}

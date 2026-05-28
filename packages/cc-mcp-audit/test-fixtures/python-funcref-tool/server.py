"""Pattern O2 fixture: single-line registration that passes a bare function
reference as the only argument.

Mirrors vnstock-style sub-MCP wiring where a sub-server registers bare
function references with no name string and no kwargs. The tool name IS the
referenced function's name. No description is available at the registration
site, so descriptions are empty.

Example (must NOT be extracted, it lives inside this docstring):
  finance_mcp.tool(docstring_example)
"""

from mcp.server.fastmcp import FastMCP

finance_mcp = FastMCP("finance")


def get_income_statements(symbol: str) -> dict:
    """Fetch income statements for a ticker."""
    return {"symbol": symbol}


def get_balance_sheet(symbol: str) -> dict:
    """Fetch the balance sheet for a ticker."""
    return {"symbol": symbol}


def add_position(symbol: str) -> dict:
    """Add a symbol to the persisted portfolio."""
    return {"symbol": symbol}


# Disabled for now: finance_mcp.tool(comment_example)
finance_mcp.tool(get_income_statements)
finance_mcp.tool(get_balance_sheet)
finance_mcp.tool(add_position)

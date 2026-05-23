"""Pattern D fixture: bare @tool decorator with multi-line kwargs.

Mirrors edgartools/edgar/ai/mcp/tools/company.py."""

from typing import Any

from base import (
    tool,
)


@tool(
    name="company_lookup",
    description="""Look up a company by ticker, CIK, or name.

Examples:
- By ticker: identifier="AAPL"
- By CIK: identifier="320193"
- Multi-include: include=["financials", "filings"]""",
    params={
        "identifier": {
            "type": "string",
            "description": "Ticker, CIK, or company name",
        },
        "include": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
)
def company_lookup(identifier: str, include: list[str] | None = None) -> dict[str, Any]:
    """Implementation lookup."""
    return {"id": identifier, "included": include or []}


@tool(
    name="company_compare",
    description="Compare multiple companies side by side.",
)
def company_compare(tickers: list[str]) -> dict[str, Any]:
    """Compare implementation."""
    return {"comparison": tickers}


# Single-line form: @tool(name="x", description="y")
@tool(name="company_delete", description="Permanently delete cached company data.")
def company_delete(identifier: str) -> dict[str, Any]:
    """Delete implementation."""
    return {"deleted": identifier}

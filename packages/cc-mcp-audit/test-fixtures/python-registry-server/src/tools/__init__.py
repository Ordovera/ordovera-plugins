"""Tools subpackage. The __all__ list IS the tool name list -- Pattern Cr
extracts from here while skipping the framework class re-exports."""

from .base import BaseTool, FunctionTool, ToolMetadata, ToolCategory
from .web import search_duckduckgo, parse_pdf, extract_webpage_content

__all__ = [
    # Framework classes -- Pattern Cr post-filter should drop these
    "BaseTool",
    "FunctionTool",
    "ToolMetadata",
    "ToolCategory",
    # Actual MCP tools
    "search_duckduckgo",
    "parse_pdf",
    "extract_webpage_content",
    "get_current_datetime",
    "calculator",
    # Helper functions -- post-filter should drop these
    "register_all_tools",
    "load_tools",
    "get_tool_definitions",
    "call_tool_handler",
]

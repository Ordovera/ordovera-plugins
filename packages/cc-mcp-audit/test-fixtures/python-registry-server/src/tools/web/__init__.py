"""Web tools subpackage. Leaf __init__.py with a clean __all__ list."""

from .duckduckgo import search_duckduckgo
from .extract import extract_webpage_content
from .pdf import parse_pdf

__all__ = [
    "search_duckduckgo",
    "extract_webpage_content",
    "parse_pdf",
]

"""Pattern P fixture: multi-line `<x>.tool(func_ref, name=..., description=...)`.

Mirrors the qdrant-mcp shape: a FastMCP subclass registers tools in a
setup_tools() method by passing a function reference positionally followed by
explicit `name=` and `description=` kwargs. The explicit name wins over the
function reference.

Example (must NOT be extracted, it lives inside this docstring):
  self.tool(
      example_ref,
      name="docstring-tool",
      description="Should be ignored.",
  )
"""

from mcp.server.fastmcp import FastMCP


def find_memories(query: str) -> list:
    return []


def store_memory(content: str) -> dict:
    return {"stored": content}


class QdrantMCP(FastMCP):
    def setup_tools(self) -> None:
        self.tool(
            find_memories,
            name="qdrant-find",
            description="Look up memories matching a query.",
        )
        self.tool(
            store_memory,
            name="qdrant-store",
            description="Insert a new memory into Qdrant.",
        )

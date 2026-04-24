"""MCP server using class-based tool registration pattern."""
from mcp.server import FastMCP


class Tool:
    """Base tool class."""
    @classmethod
    def get_name_from_cls(cls):
        name = cls.__name__
        if name.endswith("Tool"):
            name = name[:-4]
        return name


class ToolMarkerCanEdit:
    pass


class ReadFileTool(Tool):
    """Read file contents."""

    def apply(self, path: str) -> str:
        """Reads the given file and returns its content"""
        pass


class CreateTextFileTool(Tool, ToolMarkerCanEdit):
    """Create new text files."""

    def apply(self, path: str, content: str) -> str:
        """Creates a new text file with the specified content"""
        pass


class ListDirTool(Tool):
    """List directory contents."""

    def apply(self, path: str) -> str:
        """Lists all files and directories in the given path"""
        pass


class ExecuteShellCommandTool(Tool, ToolMarkerCanEdit):
    """Execute shell commands."""

    def apply(self, command: str) -> str:
        """Execute a shell command and return its output"""
        pass


class SafeDeleteSymbol(Tool, ToolMarkerCanEdit):
    """Delete a symbol safely with refactoring support."""

    def apply(self, symbol: str) -> str:
        """Safely deletes a symbol using language server refactoring"""
        pass

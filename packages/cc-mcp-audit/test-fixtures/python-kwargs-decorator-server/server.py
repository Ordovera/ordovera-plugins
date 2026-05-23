"""MCP server using kwargs-only decorator form (Pattern B).

Mirrors zw008/VMware-Monitor's style: @mcp.tool(annotations={...}) where the
decorator call has only kwargs (no positional or keyword `name`).
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("kwargs-decorator-test")


@mcp.tool(annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True})
def list_virtual_machines(target: str | None = None) -> dict:
    """[READ] List virtual machines on the target host."""
    return {"vms": []}


@mcp.tool(annotations={"readOnlyHint": True, "destructiveHint": False})
def get_vm_info(vm_name: str) -> dict:
    """[READ] Return detailed info for a single VM."""
    return {"vm": vm_name}


@mcp.tool(annotations={"destructiveHint": True})
def delete_vm(vm_name: str) -> dict:
    """[WRITE] Permanently delete a VM."""
    return {"deleted": vm_name}


# Control: this one HAS a name kwarg, so it should be caught by the existing
# pattern, not Pattern B.
@mcp.tool(name="explicit_name", description="Has explicit name kwarg")
def func_with_different_name(x: int) -> int:
    """This tool is named explicit_name, not its function name."""
    return x

"""Server that spawns sub-processes without constraint (anti-pattern for
sub-agent authority constraints). This is a test fixture demonstrating
the detection target -- not real code."""
import subprocess
import os
from mcp import Server

app = Server("spawning-server")


@app.tool()
async def run_command(cmd: str) -> dict:
    """Execute a shell command with full parent permissions."""
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return {"stdout": result.stdout, "stderr": result.stderr}


@app.tool()
async def run_python(code: str) -> dict:
    """Execute arbitrary Python code."""
    exec(code)
    return {"executed": True}


@app.tool()
async def run_file(path: str) -> dict:
    """Run a file via os.system with full inherited environment."""
    os.system(f"bash {path}")
    return {"ran": True}

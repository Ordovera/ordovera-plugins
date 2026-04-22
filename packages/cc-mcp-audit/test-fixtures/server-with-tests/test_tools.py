"""Tests that assert tool names exist in the server."""
import pytest

def test_all_tools_registered():
    tools = get_tool_names()
    expected = ["list_users", "create_user", "delete_user", "get_status", "export_data"]
    for name in expected:
        assert name in tools

def test_read_tools():
    read_tools = get_read_tools()
    assert "list_users" in read_tools
    assert "get_status" in read_tools

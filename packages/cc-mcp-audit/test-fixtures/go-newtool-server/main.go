// Pattern J1 fixture: mark3labs/mcp-go style registration. Each tool is built
// by calling NewTool with a positional name string, then registered via
// AddTool. The description comes from a WithDescription option on the same or a
// following line within the call.
package main

import (
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func registerTools(s *server.MCPServer) {
	// Example usage: mcp.NewTool("commented_line_tool", mcp.WithDescription("ignore me"))
	/* block example: foo := mcp.NewTool("commented_block_tool") */
	getRepo := mcp.NewTool("get_repository",
		mcp.WithDescription("Fetch metadata for a repository."),
		mcp.WithString("owner"),
	)

	createRelease := mcp.NewTool("create_release", mcp.WithDescription("Publish a new release."))

	searchIssues := mcp.NewTool("search_issues",
		mcp.WithDescription("Search issues across repositories."),
	)

	s.AddTool(getRepo, handleGetRepo)
	s.AddTool(createRelease, handleCreateRelease)
	s.AddTool(searchIssues, handleSearchIssues)
}

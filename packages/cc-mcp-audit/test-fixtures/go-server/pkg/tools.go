package tools

import (
	"context"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func GetIssue(t TranslationFunc) ServerTool {
	return NewTool(
		ToolsetIssues,
		mcp.Tool{
			Name:        "get_issue",
			Description: "Get details of a specific issue",
			InputSchema: jsonschema.Schema{
				Type: "object",
				Properties: map[string]*jsonschema.Schema{
					"owner": {Type: "string"},
					"repo":  {Type: "string"},
					"issue_number": {Type: "number"},
				},
			},
			Annotations: &mcp.ToolAnnotations{
				ReadOnlyHint: true,
			},
		},
		[]Scope{ScopeReadIssues},
		func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return nil, nil
		},
	)
}

func CreateIssue(t TranslationFunc) ServerTool {
	return NewTool(
		ToolsetIssues,
		mcp.Tool{
			Name:        "create_issue",
			Description: "Create a new issue in a repository",
		},
		[]Scope{ScopeWriteIssues},
		func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return nil, nil
		},
	)
}

func SearchCode(t TranslationFunc) ServerTool {
	return NewTool(
		ToolsetRepos,
		mcp.Tool{
			Name:        "search_code",
			Description: "Search for code across repositories",
			Annotations: &mcp.ToolAnnotations{
				ReadOnlyHint: true,
			},
		},
		[]Scope{ScopeReadRepos},
		func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return nil, nil
		},
	)
}

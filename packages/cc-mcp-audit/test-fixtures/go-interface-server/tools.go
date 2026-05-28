// Pattern J2 fixture: custom Go MCP layer where each tool is a struct
// implementing a tool interface. The tool name is the literal returned by the
// `Name() string` method. The file is gated on the presence of an
// `InputSchema(` method so arbitrary structs with a Name() are not matched.
package tools

import "context"

type GetWeatherTool struct{}

func (t GetWeatherTool) Name() string {
	return "get_weather"
}

func (t GetWeatherTool) InputSchema() Schema {
	return Schema{Type: "object"}
}

func (t GetWeatherTool) Handle(ctx context.Context) (any, error) {
	return nil, nil
}

type CreateAlertTool struct{}

func (t CreateAlertTool) Name() string {
	return "create_alert"
}

func (t CreateAlertTool) InputSchema() Schema {
	return Schema{Type: "object"}
}

func (t CreateAlertTool) Handle(ctx context.Context) (any, error) {
	return nil, nil
}

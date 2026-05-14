/**
 * MCP JSON-RPC client for tools/list introspection.
 *
 * Supports streamable-http and SSE transports.
 * Used for remote-only servers that have no cloneable source code.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** MCP tool annotation hints (protocol spec 2024-11-05+) */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Single tool from tools/list response */
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

/** Full tools/list response */
interface ToolsListResult {
  tools: McpToolDefinition[];
  nextCursor?: string;
}

/** Initialize response for capability negotiation */
interface InitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: {
    name: string;
    version: string;
  };
}

export interface RpcToolsResult {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  tools: McpToolDefinition[];
  transportUsed: "streamable-http" | "sse";
  endpointUrl: string;
}

export interface RpcError {
  type: "connection" | "protocol" | "timeout" | "auth-required";
  message: string;
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Streamable HTTP transport
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 15_000;
let requestId = 1;

function makeRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: "2.0", id: requestId++, method, params };
}

async function httpPost(
  url: string,
  body: JsonRpcRequest,
  sessionId?: string,
  timeoutMs = DEFAULT_TIMEOUT
): Promise<JsonRpcResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "cc-mcp-audit/1.0",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw makeRpcError("auth-required", `Server requires authentication (HTTP ${response.status})`, response.status);
    }

    if (!response.ok) {
      throw makeRpcError("connection", `HTTP ${response.status}: ${response.statusText}`, response.status);
    }

    const data = (await response.json()) as JsonRpcResponse;

    // Extract session ID from response headers if present
    const newSessionId = response.headers.get("Mcp-Session-Id");

    // Attach session ID to response for caller to use
    if (newSessionId) {
      (data as JsonRpcResponse & { _sessionId?: string })._sessionId = newSessionId;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch tools from a streamable-http MCP endpoint.
 */
export async function fetchToolsStreamableHttp(
  endpointUrl: string,
  timeoutMs = DEFAULT_TIMEOUT
): Promise<RpcToolsResult | RpcError> {
  try {
    // Step 1: Initialize
    const initReq = makeRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "cc-mcp-audit", version: "1.0.0" },
    });

    const initResp = await httpPost(endpointUrl, initReq, undefined, timeoutMs);
    if (initResp.error) {
      return makeRpcError("protocol", `Initialize failed: ${initResp.error.message}`);
    }

    const initResult = initResp.result as InitializeResult;
    const sessionId = (initResp as JsonRpcResponse & { _sessionId?: string })._sessionId;

    // Step 2: Send initialized notification (no response expected, but some servers require it)
    const notifyReq: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: requestId++,
      method: "notifications/initialized",
    };
    // Fire and don't wait for response -- it's a notification
    try {
      await httpPost(endpointUrl, notifyReq, sessionId, 5000);
    } catch {
      // Notifications may not get responses; that's fine
    }

    // Step 3: tools/list (paginated)
    const allTools: McpToolDefinition[] = [];
    let cursor: string | undefined;

    while (true) {
      const params: Record<string, unknown> = {};
      if (cursor) params.cursor = cursor;

      const listReq = makeRequest("tools/list", params);
      const listResp = await httpPost(endpointUrl, listReq, sessionId, timeoutMs);

      if (listResp.error) {
        return makeRpcError("protocol", `tools/list failed: ${listResp.error.message}`);
      }

      const listResult = listResp.result as ToolsListResult;
      allTools.push(...listResult.tools);

      if (!listResult.nextCursor) break;
      cursor = listResult.nextCursor;
    }

    return {
      serverName: initResult.serverInfo?.name ?? "unknown",
      serverVersion: initResult.serverInfo?.version ?? "unknown",
      protocolVersion: initResult.protocolVersion ?? "unknown",
      tools: allTools,
      transportUsed: "streamable-http",
      endpointUrl,
    };
  } catch (err) {
    if (err && typeof err === "object" && "type" in err) {
      return err as RpcError;
    }
    if (err instanceof Error && err.name === "AbortError") {
      return makeRpcError("timeout", `Connection timed out after ${timeoutMs}ms`);
    }
    return makeRpcError("connection", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// SSE transport
// ---------------------------------------------------------------------------

/**
 * Fetch tools from an SSE MCP endpoint.
 *
 * SSE pattern (2024-11-05):
 *   1. GET /sse -> SSE stream, receives "endpoint" event with POST URL
 *   2. POST to that URL with JSON-RPC messages
 *   3. Responses come back on the SSE stream
 */
export async function fetchToolsSse(
  sseUrl: string,
  timeoutMs = DEFAULT_TIMEOUT
): Promise<RpcToolsResult | RpcError> {
  try {
    // Step 1: Connect to SSE and get the message endpoint
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let postEndpoint: string | null = null;

    const sseResponse = await fetch(sseUrl, {
      headers: {
        Accept: "text/event-stream",
        "User-Agent": "cc-mcp-audit/1.0",
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!sseResponse.ok) {
      if (sseResponse.status === 401 || sseResponse.status === 403) {
        return makeRpcError("auth-required", `Server requires authentication (HTTP ${sseResponse.status})`, sseResponse.status);
      }
      return makeRpcError("connection", `SSE HTTP ${sseResponse.status}: ${sseResponse.statusText}`, sseResponse.status);
    }

    if (!sseResponse.body) {
      return makeRpcError("protocol", "SSE response has no body");
    }

    // Read the SSE stream to find the endpoint event and collect responses
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const pendingResponses = new Map<number, (resp: JsonRpcResponse) => void>();

    async function readSseEvents(): Promise<void> {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData = line.slice(6).trim();
          } else if (line === "") {
            // End of event
            if (eventType === "endpoint" && eventData) {
              // Resolve relative URLs against the SSE URL
              try {
                postEndpoint = new URL(eventData, sseUrl).toString();
              } catch {
                postEndpoint = eventData;
              }
            } else if (eventType === "message" && eventData) {
              try {
                const resp = JSON.parse(eventData) as JsonRpcResponse;
                const resolver = pendingResponses.get(resp.id);
                if (resolver) {
                  resolver(resp);
                  pendingResponses.delete(resp.id);
                }
              } catch {
                // Skip unparseable messages
              }
            }
            eventType = "";
            eventData = "";
          }
        }

        if (postEndpoint) break; // Got the endpoint, move on
      }
    }

    // Read until we get the endpoint
    const endpointTimer = setTimeout(() => controller.abort(), timeoutMs);
    await readSseEvents();
    clearTimeout(endpointTimer);

    if (!postEndpoint) {
      reader.cancel();
      return makeRpcError("protocol", "SSE stream did not provide an endpoint event");
    }

    // For SSE, we POST to the endpoint and read responses from the SSE stream
    // but in practice many SSE servers also return JSON-RPC responses to the POST
    // Use a simplified approach: POST and read response directly
    const initReq = makeRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "cc-mcp-audit", version: "1.0.0" },
    });

    const initResp = await httpPost(postEndpoint, initReq, undefined, timeoutMs);
    if (initResp.error) {
      reader.cancel();
      return makeRpcError("protocol", `Initialize failed: ${initResp.error.message}`);
    }

    const initResult = initResp.result as InitializeResult;

    // tools/list
    const listReq = makeRequest("tools/list");
    const listResp = await httpPost(postEndpoint, listReq, undefined, timeoutMs);

    reader.cancel(); // Done with SSE stream

    if (listResp.error) {
      return makeRpcError("protocol", `tools/list failed: ${listResp.error.message}`);
    }

    const listResult = listResp.result as ToolsListResult;

    return {
      serverName: initResult.serverInfo?.name ?? "unknown",
      serverVersion: initResult.serverInfo?.version ?? "unknown",
      protocolVersion: initResult.protocolVersion ?? "unknown",
      tools: listResult.tools,
      transportUsed: "sse",
      endpointUrl: sseUrl,
    };
  } catch (err) {
    if (err && typeof err === "object" && "type" in err) {
      return err as RpcError;
    }
    if (err instanceof Error && err.name === "AbortError") {
      return makeRpcError("timeout", `Connection timed out after ${timeoutMs}ms`);
    }
    return makeRpcError("connection", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Fetch tools from a remote MCP server, auto-detecting transport.
 *
 * Tries streamable-http first (POST to URL), falls back to SSE (GET).
 */
export async function fetchToolsRemote(
  endpointUrl: string,
  transport?: "streamable-http" | "sse",
  timeoutMs = DEFAULT_TIMEOUT
): Promise<RpcToolsResult | RpcError> {
  if (transport === "sse") {
    return fetchToolsSse(endpointUrl, timeoutMs);
  }

  if (transport === "streamable-http") {
    return fetchToolsStreamableHttp(endpointUrl, timeoutMs);
  }

  // Auto-detect: try streamable-http first, fall back to SSE
  const httpResult = await fetchToolsStreamableHttp(endpointUrl, timeoutMs);
  if (!isRpcError(httpResult)) return httpResult;

  // If streamable-http failed with a connection error (not auth), try SSE
  if (httpResult.type !== "auth-required") {
    const sseResult = await fetchToolsSse(endpointUrl, timeoutMs);
    if (!isRpcError(sseResult)) return sseResult;
    // Return the SSE error since it was the last attempt
    return sseResult;
  }

  return httpResult;
}

// ---------------------------------------------------------------------------
// Mapping to ExtractedTool
// ---------------------------------------------------------------------------

import type { ExtractedTool } from "./types.js";
import { refineClassifications } from "./classify.js";

/**
 * Convert MCP tools/list results to ExtractedTool[] for the audit pipeline.
 */
export function mapRpcToolsToExtracted(tools: McpToolDefinition[], endpointUrl: string): ExtractedTool[] {
  const raw: ExtractedTool[] = tools.map((tool) => {
    // Use annotation hints for classification when available
    let classification: ExtractedTool["classification"] = "unknown";
    if (tool.annotations) {
      if (tool.annotations.readOnlyHint === true) {
        classification = "read";
      } else if (tool.annotations.destructiveHint === true) {
        classification = "write";
      }
    }

    return {
      name: tool.name,
      description: tool.description ?? "",
      classification,
      writeSignals: [],
      sensitivity: "unknown" as const,
      sensitivityCategory: null,
      sensitivitySignals: [],
      sourceFile: `[remote] ${endpointUrl}`,
      sourceLine: 0,
    };
  });

  // Apply the same keyword-based classification refinement as source extraction
  return refineClassifications(raw);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRpcError(type: RpcError["type"], message: string, statusCode?: number): RpcError {
  return { type, message, statusCode };
}

export function isRpcError(result: RpcToolsResult | RpcError): result is RpcError {
  return "type" in result && "message" in result && !("tools" in result);
}

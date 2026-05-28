// Pattern L fixture (const tools array): the ListTools handler returns
// `{ tools: TOOLS }` where TOOLS is a same-file const array of inline tool
// descriptors. inputSchema is built via a helper call (no nested inline name:),
// mirroring the novada / domain-search shape. Exercises the `tools: IDENT`
// const-resolution path.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

declare function buildSchema(x: unknown): unknown;
declare const RepoParams: unknown;
declare const DelParams: unknown;
declare const SearchParams: unknown;

const TOOLS = [
  { name: "list_repos", description: "List repositories.", inputSchema: buildSchema(RepoParams) },
  { name: "delete_repo", description: "Delete a repository.", inputSchema: buildSchema(DelParams) },
  { name: "search_code", description: "Search code across repositories.", inputSchema: buildSchema(SearchParams) },
];

const server = new Server(
  { name: "gh", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

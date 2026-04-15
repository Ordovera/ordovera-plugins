import { describe, it, expect } from "vitest";
import { extractGitHubUrls } from "./discover.js";

describe("extractGitHubUrls", () => {
  it("extracts repo URLs from markdown links", () => {
    const md = `
- [Postgres MCP](https://github.com/crystaldba/postgres-mcp) - Database access
- [Slack Server](https://github.com/modelcontextprotocol/servers) - Official servers
    `;

    const urls = extractGitHubUrls(md);
    expect(urls).toContain("https://github.com/crystaldba/postgres-mcp");
    expect(urls).toContain("https://github.com/modelcontextprotocol/servers");
  });

  it("strips tree/blob/issues paths to get repo root", () => {
    const md = `
See [source](https://github.com/owner/repo/tree/main/src)
and [issues](https://github.com/owner/repo/issues/123)
    `;

    const urls = extractGitHubUrls(md);
    expect(urls).toEqual(["https://github.com/owner/repo"]);
  });

  it("deduplicates URLs", () => {
    const md = `
- [Repo](https://github.com/owner/repo)
- [Same repo](https://github.com/owner/repo)
- [Also same](https://github.com/owner/repo/tree/main)
    `;

    const urls = extractGitHubUrls(md);
    expect(urls).toHaveLength(1);
  });

  it("handles bare URLs without markdown link syntax", () => {
    const md = `
Check out https://github.com/owner/cool-mcp-server for details.
    `;

    const urls = extractGitHubUrls(md);
    expect(urls).toContain("https://github.com/owner/cool-mcp-server");
  });

  it("handles repos with dots and hyphens in names", () => {
    const md = `
- [Complex name](https://github.com/my-org/mcp-server.v2)
    `;

    const urls = extractGitHubUrls(md);
    expect(urls).toContain("https://github.com/my-org/mcp-server.v2");
  });

  it("returns empty array for markdown with no GitHub URLs", () => {
    const md = `
# Just a heading
Some text with [a link](https://example.com) but no GitHub repos.
    `;

    const urls = extractGitHubUrls(md);
    expect(urls).toEqual([]);
  });

  it("strips trailing slashes and parens", () => {
    const md = `
- (https://github.com/owner/repo/)
    `;

    const urls = extractGitHubUrls(md);
    expect(urls).toContain("https://github.com/owner/repo");
  });

  it("handles large awesome-list style markdown", () => {
    const md = `
# Awesome MCP Servers

## Database
- [Postgres](https://github.com/crystaldba/postgres-mcp) - PostgreSQL
- [SQLite](https://github.com/nicholasbarger/mcp-sqlite) - SQLite

## Communication
- [Slack](https://github.com/nicholasbarger/mcp-slack) - Slack integration
- [Email](https://github.com/nicholasbarger/mcp-email) - Email server

## File Systems
- [Filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) - Local FS
- [S3](https://github.com/aws/mcp-s3) - AWS S3

## See Also
- [MCP Spec](https://github.com/modelcontextprotocol/specification)
    `;

    const urls = extractGitHubUrls(md);
    // Should get unique repos, with filesystem stripped to servers root
    expect(urls.length).toBeGreaterThanOrEqual(6);
    expect(urls).toContain("https://github.com/crystaldba/postgres-mcp");
    expect(urls).toContain("https://github.com/modelcontextprotocol/servers");
    expect(urls).toContain("https://github.com/modelcontextprotocol/specification");
  });
});

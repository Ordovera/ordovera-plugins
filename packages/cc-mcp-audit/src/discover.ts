import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  DiscoveredServer,
  CandidateFile,
  DiscoveryFilters,
} from "./types.js";

const CURATED_LISTS = [
  "https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md",
  "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md",
];

const GITHUB_API = "https://api.github.com";

interface GitHubSearchItem {
  full_name: string;
  html_url: string;
  clone_url: string;
  stargazers_count: number;
  pushed_at: string;
  language: string | null;
  description: string | null;
  archived: boolean;
  fork: boolean;
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubSearchItem[];
}

/**
 * Discover MCP servers from curated lists and GitHub search.
 * Returns a deduplicated, filtered candidate list.
 */
export async function discover(
  filters: DiscoveryFilters,
  options: {
    githubToken?: string;
    curatedLists?: string[];
    skipGitHubSearch?: boolean;
    skipCuratedLists?: boolean;
    existingCandidates?: string;
  } = {}
): Promise<CandidateFile> {
  const candidates: Map<string, DiscoveredServer> = new Map();
  const errors: string[] = [];

  // Load existing candidates for deduplication
  if (options.existingCandidates) {
    const existing = loadExistingCandidates(options.existingCandidates);
    for (const c of existing) {
      candidates.set(normalizeRepoKey(c.source), c);
    }
  }

  // Phase 1: Parse curated lists for repo URLs
  if (!options.skipCuratedLists) {
    const lists = options.curatedLists ?? CURATED_LISTS;
    for (const listUrl of lists) {
      try {
        const repos = await parseCuratedList(listUrl);
        for (const repo of repos) {
          const key = normalizeRepoKey(repo);
          if (!candidates.has(key)) {
            candidates.set(key, {
              source: repo,
              name: extractOwnerRepo(repo),
              url: repo,
              stars: 0,
              lastUpdated: "",
              language: "",
              description: "",
              discoveredFrom: "curated-list",
            });
          }
        }
      } catch (err) {
        errors.push(
          `Failed to fetch curated list ${listUrl}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  // Phase 2: GitHub search for MCP servers
  if (!options.skipGitHubSearch) {
    try {
      const searched = await searchGitHub(filters, options.githubToken);
      for (const item of searched) {
        const key = normalizeRepoKey(item.html_url);
        if (!candidates.has(key)) {
          candidates.set(key, {
            source: item.clone_url,
            name: item.full_name,
            url: item.html_url,
            stars: item.stargazers_count,
            lastUpdated: item.pushed_at,
            language: item.language ?? "unknown",
            description: item.description ?? "",
            discoveredFrom: "github-search",
          });
        }
      }
    } catch (err) {
      errors.push(
        `GitHub search failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Phase 3: Enrich curated-list entries with GitHub metadata
  const unenriched = [...candidates.values()].filter(
    (c) => c.discoveredFrom === "curated-list" && c.stars === 0
  );
  if (unenriched.length > 0 && options.githubToken) {
    await enrichFromGitHub(unenriched, options.githubToken);
    for (const c of unenriched) {
      candidates.set(normalizeRepoKey(c.source), c);
    }
  }

  // Phase 4: Filter
  const filtered = [...candidates.values()].filter((c) => {
    if (c.stars < filters.minStars && c.stars > 0) return false;
    if (
      filters.updatedAfter &&
      c.lastUpdated &&
      c.lastUpdated < filters.updatedAfter
    ) {
      return false;
    }
    if (filters.languages && filters.languages.length > 0 && c.language) {
      const lang = c.language.toLowerCase();
      if (!filters.languages.some((l) => l.toLowerCase() === lang)) {
        return false;
      }
    }
    if (filters.exclude) {
      const key = normalizeRepoKey(c.source);
      if (filters.exclude.some((e) => key.includes(e.toLowerCase()))) {
        return false;
      }
    }
    return true;
  });

  // Sort by stars descending
  filtered.sort((a, b) => b.stars - a.stars);

  if (errors.length > 0) {
    console.error("Discovery warnings:");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: "0.1.0",
    filters,
    candidates: filtered,
  };
}

/**
 * Parse a curated list markdown file for GitHub repo URLs.
 */
export async function parseCuratedList(
  url: string
): Promise<string[]> {
  const response = await fetch(url, {
    headers: { "User-Agent": "cc-mcp-audit" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const markdown = await response.text();
  return extractGitHubUrls(markdown);
}

/**
 * Extract GitHub repo URLs from markdown content.
 * Handles: [text](url), bare urls, and various GitHub URL formats.
 */
export function extractGitHubUrls(markdown: string): string[] {
  const urls = new Set<string>();

  // Match GitHub repo URLs in markdown links and bare URLs
  const pattern =
    /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/g;

  for (const match of markdown.matchAll(pattern)) {
    let url = match[0];
    // Normalize: strip trailing slashes, anchors, paths beyond repo
    url = url.replace(/\/(?:tree|blob|issues|pulls|wiki|releases|actions)\/.*$/, "");
    url = url.replace(/[/)]+$/, "");
    // Skip GitHub itself, profiles, and non-repo pages
    const parts = url.replace("https://github.com/", "").split("/");
    if (parts.length >= 2 && parts[0] !== "" && parts[1] !== "") {
      urls.add(url);
    }
  }

  return [...urls];
}

/**
 * Search GitHub for MCP server repositories.
 */
async function searchGitHub(
  filters: DiscoveryFilters,
  token?: string
): Promise<GitHubSearchItem[]> {
  const queries = [
    "mcp-server in:name",
    "model-context-protocol in:name",
    '"MCP server" in:description',
  ];

  const allItems: GitHubSearchItem[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    let query = `${q} stars:>=${filters.minStars}`;
    if (filters.updatedAfter) {
      query += ` pushed:>=${filters.updatedAfter}`;
    }
    if (filters.languages && filters.languages.length === 1) {
      query += ` language:${filters.languages[0]}`;
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "cc-mcp-audit",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        console.error(
          "GitHub API rate limit hit. Provide --github-token for higher limits."
        );
        break;
      }
      throw new Error(`GitHub search HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubSearchResponse;

    for (const item of data.items) {
      if (item.archived || item.fork) continue;
      if (!seen.has(item.full_name)) {
        seen.add(item.full_name);
        allItems.push(item);
      }
    }
  }

  return allItems;
}

/**
 * Enrich candidates with GitHub API metadata (stars, language, dates).
 */
async function enrichFromGitHub(
  candidates: DiscoveredServer[],
  token: string
): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "cc-mcp-audit",
  };

  // Batch in groups of 10 to avoid hammering the API
  const batchSize = 10;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (c) => {
        const ownerRepo = extractOwnerRepo(c.source);
        const url = `${GITHUB_API}/repos/${ownerRepo}`;
        const response = await fetch(url, { headers });
        if (!response.ok) return;

        const data = (await response.json()) as GitHubSearchItem;
        c.stars = data.stargazers_count;
        c.lastUpdated = data.pushed_at;
        c.language = data.language ?? "unknown";
        c.description = data.description ?? "";
      })
    );

    // Brief pause between batches
    if (i + batchSize < candidates.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

function loadExistingCandidates(path: string): DiscoveredServer[] {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return [];

  try {
    const raw = readFileSync(fullPath, "utf-8");
    const parsed = JSON.parse(raw) as CandidateFile;
    return parsed.candidates ?? [];
  } catch {
    return [];
  }
}

function normalizeRepoKey(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function extractOwnerRepo(url: string): string {
  const match = url.match(/github\.com\/([\w.-]+\/[\w.-]+)/);
  return match?.[1] ?? url;
}

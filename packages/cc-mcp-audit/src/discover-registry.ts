/**
 * Canonical registry-based discovery for MCP servers.
 *
 * Three sources, all enumerable and snapshot-able:
 *   1. MCP Registry (registry.modelcontextprotocol.io)
 *   2. npm registry (keyword: mcp-server)
 *   3. PyPI simple index (name contains mcp-server)
 *
 * Produces a unified candidate list with provenance tags,
 * deduplicated by repository URL where available.
 */

import type { DiscoveredServer } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryEntry {
  /** Reverse-DNS name from MCP Registry */
  registryName: string;
  description: string;
  version: string;
  repositoryUrl: string | null;
  repositorySubfolder: string | null;
  transportTypes: string[];
  packageEcosystems: string[];
  remoteEndpoints: Array<{ type: string; url: string }>;
  publishedAt: string | null;
  isLatest: boolean;
}

export interface NpmEntry {
  name: string;
  version: string;
  description: string;
  repositoryUrl: string | null;
  weeklyDownloads: number;
  publishedAt: string | null;
  keywords: string[];
}

export interface PypiEntry {
  name: string;
  version: string;
  description: string;
  repositoryUrl: string | null;
  publishedAt: string | null;
}

export interface CanonicalCandidate {
  /** Unique key: owner/repo if GitHub, else package name */
  key: string;
  /** Display name */
  name: string;
  /** GitHub URL if available */
  repositoryUrl: string | null;
  /** Where this candidate was found */
  sources: CandidateSource[];
  /** Transport types declared in MCP Registry */
  transportTypes: string[];
  /** Package ecosystems (npm, pypi, oci, etc.) */
  packageEcosystems: string[];
  /** Best available description */
  description: string;
  /** npm weekly downloads (0 if not on npm) */
  npmDownloads: number;
  /** MCP Registry name (null if not in registry) */
  registryName: string | null;
  /** Most recent publish date across sources */
  latestPublishDate: string | null;
  /** Remote endpoint URLs for RPC introspection */
  remoteEndpoints: Array<{ type: string; url: string }>;
}

export interface CandidateSource {
  type: "mcp-registry" | "npm" | "pypi";
  identifier: string;
  version: string;
}

export interface CanonicalSnapshot {
  snapshotDate: string;
  sources: {
    mcpRegistry: { totalRaw: number; uniqueLatest: number };
    npm: { total: number };
    pypi: { total: number };
  };
  totalCandidates: number;
  withRepository: number;
  candidates: CanonicalCandidate[];
}

// ---------------------------------------------------------------------------
// MCP Registry puller
// ---------------------------------------------------------------------------

const MCP_REGISTRY_API = "https://registry.modelcontextprotocol.io/v0/servers";

export async function pullMcpRegistry(
  onProgress?: (fetched: number) => void
): Promise<{ entries: RegistryEntry[]; totalRaw: number }> {
  const entries: RegistryEntry[] = [];
  let cursor: string | undefined;
  let totalRaw = 0;
  const pageSize = 30; // API max is 30 per page regardless of count param

  while (true) {
    const url = new URL(MCP_REGISTRY_API);
    url.searchParams.set("count", String(pageSize));
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "cc-mcp-audit/1.0" },
    });

    if (!response.ok) {
      throw new Error(`MCP Registry HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      servers: Array<{
        server: {
          name: string;
          description?: string;
          version?: string;
          repository?: { url?: string; source?: string; subfolder?: string };
          remotes?: Array<{ type: string; url: string }>;
          packages?: Array<{
            registryType: string;
            identifier: string;
            version: string;
            transport?: { type: string };
          }>;
        };
        _meta?: {
          "io.modelcontextprotocol.registry/official"?: {
            status: string;
            publishedAt?: string;
            isLatest?: boolean;
          };
        };
      }>;
      metadata?: { nextCursor?: string; count?: number };
    };

    totalRaw += data.servers.length;

    for (const entry of data.servers) {
      const srv = entry.server;
      const meta = entry._meta?.["io.modelcontextprotocol.registry/official"];

      // Collect transport types from remotes and packages
      const transports = new Set<string>();
      for (const r of srv.remotes ?? []) transports.add(r.type);
      for (const p of srv.packages ?? []) {
        if (p.transport?.type) transports.add(p.transport.type);
      }

      // Collect package ecosystems
      const ecosystems = new Set<string>();
      for (const p of srv.packages ?? []) ecosystems.add(p.registryType);

      const repoUrl = srv.repository?.url || null;

      // Collect remote endpoint URLs
      const remoteEndpoints: Array<{ type: string; url: string }> = [];
      for (const r of srv.remotes ?? []) {
        remoteEndpoints.push({ type: r.type, url: r.url });
      }

      entries.push({
        registryName: srv.name,
        description: srv.description ?? "",
        version: srv.version ?? "",
        repositoryUrl: repoUrl ? normalizeGitHubUrl(repoUrl) : null,
        repositorySubfolder: srv.repository?.subfolder ?? null,
        transportTypes: [...transports],
        packageEcosystems: [...ecosystems],
        remoteEndpoints,
        publishedAt: meta?.publishedAt ?? null,
        isLatest: meta?.isLatest ?? false,
      });
    }

    onProgress?.(totalRaw);

    const nextCursor = data.metadata?.nextCursor;
    if (!nextCursor || data.servers.length === 0) break;
    cursor = nextCursor;

    // Brief pause between pages
    await sleep(200);
  }

  return { entries, totalRaw };
}

// ---------------------------------------------------------------------------
// npm puller
// ---------------------------------------------------------------------------

const NPM_SEARCH_API = "https://registry.npmjs.org/-/v1/search";

export async function pullNpm(
  onProgress?: (fetched: number) => void
): Promise<NpmEntry[]> {
  const entries: NpmEntry[] = [];
  const seen = new Set<string>();
  let from = 0;
  const size = 250;

  // Search with multiple queries to maximize coverage
  const queries = ["keywords:mcp-server", "keywords:model-context-protocol"];

  for (const query of queries) {
    from = 0;
    while (true) {
      const url = `${NPM_SEARCH_API}?text=${encodeURIComponent(query)}&size=${size}&from=${from}`;
      const response = await fetch(url, {
        headers: { "User-Agent": "cc-mcp-audit/1.0" },
      });

      if (!response.ok) {
        if (response.status === 429 || response.status === 503) {
          await sleep(5000);
          continue;
        }
        throw new Error(`npm search HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        total: number;
        objects: Array<{
          package: {
            name: string;
            version: string;
            description?: string;
            keywords?: string[];
            links?: { repository?: string };
            date?: string;
          };
          score?: { detail?: { popularity?: number } };
          downloads?: { weekly?: number };
        }>;
      };

      if (data.objects.length === 0) break;

      let newInPage = 0;
      for (const obj of data.objects) {
        const pkg = obj.package;
        if (seen.has(pkg.name)) continue;
        seen.add(pkg.name);
        newInPage++;

        const repoUrl = pkg.links?.repository
          ? normalizeGitHubUrl(pkg.links.repository)
          : null;

        entries.push({
          name: pkg.name,
          version: pkg.version,
          description: pkg.description ?? "",
          repositoryUrl: repoUrl,
          weeklyDownloads: 0, // Will be enriched separately if needed
          publishedAt: pkg.date ?? null,
          keywords: pkg.keywords ?? [],
        });
      }

      onProgress?.(entries.length);

      // Stop if this page had no new results (all duplicates from prior query)
      if (newInPage === 0) break;

      from += data.objects.length;
      if (from >= data.total || data.objects.length < size) break;

      await sleep(300);
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// PyPI puller
// ---------------------------------------------------------------------------

export async function pullPypi(
  onProgress?: (fetched: number) => void
): Promise<PypiEntry[]> {
  // PyPI doesn't have a search API. Use the simple index to find package names,
  // then fetch metadata for each.
  const response = await fetch("https://pypi.org/simple/", {
    headers: { "User-Agent": "cc-mcp-audit/1.0", Accept: "text/html" },
  });

  if (!response.ok) {
    throw new Error(`PyPI simple index HTTP ${response.status}`);
  }

  const html = await response.text();

  // Extract package names containing "mcp-server" or "mcp_server"
  const packageNames: string[] = [];
  const linkRe = /<a href="\/simple\/([^/]+)\/">/g;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const name = match[1];
    if (name.includes("mcp-server") || name.includes("mcp_server")) {
      packageNames.push(name);
    }
  }

  onProgress?.(0);

  // Fetch metadata for each package (batched)
  const entries: PypiEntry[] = [];
  const batchSize = 20;

  for (let i = 0; i < packageNames.length; i += batchSize) {
    const batch = packageNames.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (name) => {
        const url = `https://pypi.org/pypi/${name}/json`;
        const resp = await fetch(url, {
          headers: { "User-Agent": "cc-mcp-audit/1.0" },
        });
        if (!resp.ok) return null;

        const data = (await resp.json()) as {
          info: {
            name: string;
            version: string;
            summary?: string;
            project_urls?: Record<string, string>;
          };
          urls?: Array<{ upload_time_iso_8601?: string }>;
        };

        // Find repository URL from project_urls
        let repoUrl: string | null = null;
        const projectUrls = data.info.project_urls ?? {};
        for (const [key, value] of Object.entries(projectUrls)) {
          if (
            /repository|source|github|code|homepage/i.test(key) &&
            value.includes("github.com")
          ) {
            repoUrl = normalizeGitHubUrl(value);
            break;
          }
        }

        const publishedAt =
          data.urls?.[0]?.upload_time_iso_8601 ?? null;

        return {
          name: data.info.name,
          version: data.info.version,
          description: data.info.summary ?? "",
          repositoryUrl: repoUrl,
          publishedAt,
        };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        entries.push(result.value);
      }
    }

    onProgress?.(entries.length);
    if (i + batchSize < packageNames.length) await sleep(500);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Merge and deduplicate
// ---------------------------------------------------------------------------

export function mergeCanonical(
  registry: RegistryEntry[],
  npm: NpmEntry[],
  pypi: PypiEntry[]
): CanonicalCandidate[] {
  const byRepo = new Map<string, CanonicalCandidate>();
  const byName = new Map<string, CanonicalCandidate>();

  function getOrCreate(repoUrl: string | null, fallbackName: string): CanonicalCandidate {
    if (repoUrl) {
      const key = normalizeRepoKey(repoUrl);
      if (byRepo.has(key)) return byRepo.get(key)!;
      const candidate: CanonicalCandidate = {
        key,
        name: extractRepoName(repoUrl),
        repositoryUrl: repoUrl,
        sources: [],
        transportTypes: [],
        packageEcosystems: [],
        description: "",
        npmDownloads: 0,
        registryName: null,
        latestPublishDate: null,
        remoteEndpoints: [],
      };
      byRepo.set(key, candidate);
      return candidate;
    }

    // No repo URL -- key by package name
    if (byName.has(fallbackName)) return byName.get(fallbackName)!;
    const candidate: CanonicalCandidate = {
      key: fallbackName,
      name: fallbackName,
      repositoryUrl: null,
      sources: [],
      transportTypes: [],
      packageEcosystems: [],
      description: "",
      npmDownloads: 0,
      registryName: null,
      latestPublishDate: null,
      remoteEndpoints: [],
    };
    byName.set(fallbackName, candidate);
    return candidate;
  }

  // Merge MCP Registry entries (isLatest only)
  for (const entry of registry.filter((e) => e.isLatest)) {
    const candidate = getOrCreate(entry.repositoryUrl, entry.registryName);
    candidate.sources.push({
      type: "mcp-registry",
      identifier: entry.registryName,
      version: entry.version,
    });
    candidate.registryName = entry.registryName;
    if (!candidate.description) candidate.description = entry.description;
    for (const t of entry.transportTypes) {
      if (!candidate.transportTypes.includes(t)) candidate.transportTypes.push(t);
    }
    for (const e of entry.packageEcosystems) {
      if (!candidate.packageEcosystems.includes(e)) candidate.packageEcosystems.push(e);
    }
    for (const ep of entry.remoteEndpoints) {
      if (!candidate.remoteEndpoints.some(e => e.url === ep.url)) {
        candidate.remoteEndpoints.push(ep);
      }
    }
    updatePublishDate(candidate, entry.publishedAt);
  }

  // Merge npm entries
  for (const entry of npm) {
    const candidate = getOrCreate(entry.repositoryUrl, entry.name);
    candidate.sources.push({
      type: "npm",
      identifier: entry.name,
      version: entry.version,
    });
    candidate.npmDownloads = Math.max(candidate.npmDownloads, entry.weeklyDownloads);
    if (!candidate.description) candidate.description = entry.description;
    if (!candidate.packageEcosystems.includes("npm")) {
      candidate.packageEcosystems.push("npm");
    }
    updatePublishDate(candidate, entry.publishedAt);
  }

  // Merge PyPI entries
  for (const entry of pypi) {
    const candidate = getOrCreate(entry.repositoryUrl, entry.name);
    candidate.sources.push({
      type: "pypi",
      identifier: entry.name,
      version: entry.version,
    });
    if (!candidate.description) candidate.description = entry.description;
    if (!candidate.packageEcosystems.includes("pypi")) {
      candidate.packageEcosystems.push("pypi");
    }
    updatePublishDate(candidate, entry.publishedAt);
  }

  // Combine both maps
  const all = new Map<string, CanonicalCandidate>();
  for (const [k, v] of byRepo) all.set(k, v);
  for (const [k, v] of byName) {
    if (!all.has(k)) all.set(k, v);
  }

  return [...all.values()];
}

// ---------------------------------------------------------------------------
// Full snapshot pipeline
// ---------------------------------------------------------------------------

export async function snapshotCanonicalSources(
  onProgress?: (message: string) => void
): Promise<CanonicalSnapshot> {
  onProgress?.("Pulling MCP Registry...");
  const { entries: registryEntries, totalRaw: registryTotalRaw } =
    await pullMcpRegistry((n) => onProgress?.(`  MCP Registry: ${n} raw entries fetched`));

  const registryLatest = registryEntries.filter((e) => e.isLatest);
  onProgress?.(
    `  MCP Registry: ${registryTotalRaw} raw -> ${registryLatest.length} unique (isLatest)`
  );

  let npmEntries: NpmEntry[] = [];
  try {
    onProgress?.("Pulling npm...");
    npmEntries = await pullNpm((n) =>
      onProgress?.(`  npm: ${n} packages fetched`)
    );
    onProgress?.(`  npm: ${npmEntries.length} total packages`);
  } catch (err) {
    onProgress?.(`  npm: FAILED (${err instanceof Error ? err.message : String(err)}), continuing with ${npmEntries.length} packages`);
  }

  let pypiEntries: PypiEntry[] = [];
  try {
    onProgress?.("Pulling PyPI...");
    pypiEntries = await pullPypi((n) =>
      onProgress?.(`  PyPI: ${n} packages fetched`)
    );
    onProgress?.(`  PyPI: ${pypiEntries.length} total packages`);
  } catch (err) {
    onProgress?.(`  PyPI: FAILED (${err instanceof Error ? err.message : String(err)}), continuing with ${pypiEntries.length} packages`);
  }

  onProgress?.("Merging and deduplicating...");
  const candidates = mergeCanonical(registryEntries, npmEntries, pypiEntries);

  const withRepo = candidates.filter((c) => c.repositoryUrl !== null).length;
  onProgress?.(
    `  ${candidates.length} unique candidates (${withRepo} with repository URL)`
  );

  return {
    snapshotDate: new Date().toISOString(),
    sources: {
      mcpRegistry: {
        totalRaw: registryTotalRaw,
        uniqueLatest: registryLatest.length,
      },
      npm: { total: npmEntries.length },
      pypi: { total: pypiEntries.length },
    },
    totalCandidates: candidates.length,
    withRepository: withRepo,
    candidates,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeGitHubUrl(url: string): string {
  let normalized = url
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .replace(/\/(?:tree|blob|issues|pulls|wiki|releases|actions)\/.*$/, "");
  // Strip fragments and query params
  normalized = normalized.split("#")[0].split("?")[0];
  return normalized;
}

function normalizeRepoKey(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function extractRepoName(url: string): string {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  return match?.[1] ?? url;
}

function updatePublishDate(
  candidate: CanonicalCandidate,
  date: string | null
): void {
  if (!date) return;
  if (!candidate.latestPublishDate || date > candidate.latestPublishDate) {
    candidate.latestPublishDate = date;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

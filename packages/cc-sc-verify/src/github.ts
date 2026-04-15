/**
 * GitHub API client for repo status and content verification.
 *
 * Uses the REST API with optional GITHUB_TOKEN authentication.
 * Unauthenticated: 60 req/hr. Authenticated: 5,000 req/hr.
 */

import type { RepoStatus, RemotePluginState } from "./types.js";

const GITHUB_API = "https://api.github.com";

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "cc-sc-verify",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJson<T>(url: string): Promise<{ data: T | null; status: number }> {
  try {
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) {
      return { data: null, status: response.status };
    }
    const data = (await response.json()) as T;
    return { data, status: response.status };
  } catch {
    return { data: null, status: 0 };
  }
}

interface GitHubRepo {
  archived: boolean;
  visibility: string;
  default_branch: string;
  owner: { login: string };
}

export async function checkRepoStatus(
  repo: string,
  originalOwner?: string
): Promise<RepoStatus> {
  const { data, status } = await fetchJson<GitHubRepo>(
    `${GITHUB_API}/repos/${repo}`
  );

  if (status === 404) {
    return {
      exists: false,
      archived: false,
      visibility: null,
      default_branch: null,
      owner_changed: false,
      current_owner: null,
      original_owner: originalOwner ?? repo.split("/")[0],
      error: "Repository not found (deleted or private)",
    };
  }

  if (status === 0 || !data) {
    return {
      exists: false,
      archived: false,
      visibility: null,
      default_branch: null,
      owner_changed: false,
      current_owner: null,
      original_owner: originalOwner ?? repo.split("/")[0],
      error: "Failed to reach GitHub API",
    };
  }

  const currentOwner = data.owner.login;
  const origOwner = originalOwner ?? repo.split("/")[0];

  return {
    exists: true,
    archived: data.archived,
    visibility: data.visibility,
    default_branch: data.default_branch,
    owner_changed: currentOwner.toLowerCase() !== origOwner.toLowerCase(),
    current_owner: currentOwner,
    original_owner: origOwner,
  };
}

interface GitHubCommit {
  sha: string;
}

export async function getLatestCommitSha(
  repo: string,
  branch: string
): Promise<string | null> {
  const { data } = await fetchJson<GitHubCommit>(
    `${GITHUB_API}/repos/${repo}/commits/${branch}`
  );
  return data?.sha ?? null;
}

interface GitHubTreeEntry {
  path: string;
  type: "blob" | "tree";
}

interface GitHubTree {
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

export async function getRemotePluginState(
  repo: string,
  branch: string,
  pluginPath: string
): Promise<RemotePluginState> {
  // Get the tree for the plugin directory
  const treePath = pluginPath ? `${pluginPath}` : "";
  const { data: tree } = await fetchJson<GitHubTree>(
    `${GITHUB_API}/repos/${repo}/git/trees/${branch}?recursive=1`
  );

  if (!tree) {
    return {
      plugin_json: null,
      skills: [],
      hooks: [],
      commit_sha: null,
      error: "Failed to fetch repository tree",
    };
  }

  // Extract skills directories
  const skillsPrefix = pluginPath ? `${pluginPath}/skills/` : "skills/";
  const skills = new Set<string>();
  for (const entry of tree.tree) {
    if (entry.path.startsWith(skillsPrefix) && entry.type === "tree") {
      const relative = entry.path.slice(skillsPrefix.length);
      // Only top-level skill directories (no nested paths)
      if (relative && !relative.includes("/")) {
        skills.add(relative);
      }
    }
  }

  // Extract hook files
  const hooksPrefix = pluginPath ? `${pluginPath}/hooks/` : "hooks/";
  const hooks: string[] = [];
  for (const entry of tree.tree) {
    if (
      entry.path.startsWith(hooksPrefix) &&
      entry.type === "blob" &&
      !entry.path.slice(hooksPrefix.length).includes("/")
    ) {
      const filename = entry.path.slice(hooksPrefix.length);
      if (!filename.startsWith(".")) {
        hooks.push(filename);
      }
    }
  }

  // Fetch plugin.json
  const pluginJsonPath = pluginPath
    ? `${pluginPath}/.claude-plugin/plugin.json`
    : ".claude-plugin/plugin.json";
  const { data: pluginJsonBlob } = await fetchJson<{ content: string; encoding: string }>(
    `${GITHUB_API}/repos/${repo}/contents/${pluginJsonPath}?ref=${branch}`
  );

  let pluginJson = null;
  if (pluginJsonBlob?.content) {
    try {
      const decoded = Buffer.from(pluginJsonBlob.content, "base64").toString("utf-8");
      pluginJson = JSON.parse(decoded);
    } catch {
      // Failed to parse plugin.json
    }
  }

  const latestSha = await getLatestCommitSha(repo, branch);

  return {
    plugin_json: pluginJson,
    skills: Array.from(skills).sort(),
    hooks: hooks.sort(),
    commit_sha: latestSha,
  };
}

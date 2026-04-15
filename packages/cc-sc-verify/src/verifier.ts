/**
 * Core verification logic -- compares cached plugin state against
 * remote source repo state.
 */

import {
  readInstalledPlugins,
  readKnownMarketplaces,
  readCachedPluginJson,
  listCachedSkills,
  listCachedHookFiles,
  resolveRepo,
  parsePluginKey,
} from "./reader.js";
import { checkRepoStatus, getRemotePluginState } from "./github.js";
import {
  buildLocalPermissionSurface,
  detectEscalations,
} from "./permissions.js";
import {
  hashLocalFiles,
  hashRemoteFiles,
  compareHashes,
} from "./integrity.js";
import { scanPluginDeps } from "./deps.js";
import type {
  DepScanSummary,
  DriftStatus,
  HookDiff,
  IntegritySummary,
  PermissionEscalationSummary,
  PluginReport,
  SkillDiff,
  VerificationReport,
} from "./types.js";

function computeSkillDiff(local: string[], remote: string[]): SkillDiff {
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  return {
    added: remote.filter((s) => !localSet.has(s)),
    removed: local.filter((s) => !remoteSet.has(s)),
  };
}

function computeHookDiff(local: string[], remote: string[]): HookDiff {
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  return {
    added: remote.filter((h) => !localSet.has(h)),
    removed: local.filter((h) => !remoteSet.has(h)),
  };
}

export interface VerifyOptions {
  /** Only check plugins from this marketplace */
  marketplace?: string;
  /** Only check this specific plugin key */
  plugin?: string;
  /** Run deep analysis (permissions, integrity, deps). Default: true */
  deep?: boolean;
}

export async function verifyPlugins(
  options?: VerifyOptions
): Promise<VerificationReport> {
  const errors: string[] = [];

  const installed = await readInstalledPlugins();
  if (!installed) {
    return {
      checked_at: new Date().toISOString(),
      plugins_checked: 0,
      plugins_with_issues: 0,
      plugins: [],
      errors: ["Could not read ~/.claude/plugins/installed_plugins.json"],
    };
  }

  const marketplaces = await readKnownMarketplaces();
  if (!marketplaces) {
    return {
      checked_at: new Date().toISOString(),
      plugins_checked: 0,
      plugins_with_issues: 0,
      plugins: [],
      errors: ["Could not read ~/.claude/plugins/known_marketplaces.json"],
    };
  }

  const reports: PluginReport[] = [];

  for (const [pluginKey, installs] of Object.entries(installed.plugins)) {
    if (!installs || installs.length === 0) continue;

    const { pluginName, marketplace } = parsePluginKey(pluginKey);

    // Filter by marketplace if specified
    if (options?.marketplace && marketplace !== options.marketplace) continue;
    // Filter by specific plugin if specified
    if (options?.plugin && pluginKey !== options.plugin) continue;

    const install = installs[0]; // Use first (most recent) install
    const resolved = resolveRepo(pluginKey, marketplaces);

    if (!resolved) {
      errors.push(`Could not resolve repo for ${pluginKey}`);
      continue;
    }

    const warnings: string[] = [];

    // Check repo status
    const repoStatus = await checkRepoStatus(
      resolved.repo,
      resolved.repo.split("/")[0]
    );

    if (!repoStatus.exists) {
      reports.push({
        plugin_name: pluginName,
        marketplace: resolved.marketplace,
        repo: resolved.repo,
        installed_version: install.version,
        installed_at: install.installedAt,
        last_updated: install.lastUpdated,
        installed_sha: install.gitCommitSha ?? null,
        repo_status: repoStatus,
        drift_status: "unknown",
        current_sha: null,
        skill_diff: { added: [], removed: [] },
        hook_diff: { added: [], removed: [] },
        description_changed: false,
        permission_escalation: null,
        integrity: null,
        dep_scan: null,
        warnings: [repoStatus.error ?? "Repository not found"],
      });
      continue;
    }

    if (repoStatus.archived) {
      warnings.push("Repository is archived -- no further updates expected");
    }
    if (repoStatus.owner_changed) {
      warnings.push(
        `Repository ownership changed: ${repoStatus.original_owner} -> ${repoStatus.current_owner}`
      );
    }

    // Determine the plugin path within the repo
    // Monorepo plugins: plugins/<pluginName>/
    // Single-plugin repos: root
    const pluginPath = await detectPluginPath(
      resolved.repo,
      repoStatus.default_branch ?? "main",
      pluginName
    );

    // Get remote state
    const remoteState = await getRemotePluginState(
      resolved.repo,
      repoStatus.default_branch ?? "main",
      pluginPath
    );

    if (remoteState.error) {
      warnings.push(remoteState.error);
    }

    // Read local cached state
    const localPluginJson = await readCachedPluginJson(install.installPath);
    const localSkills = await listCachedSkills(install.installPath);
    const localHooks = await listCachedHookFiles(install.installPath);

    // Compute diffs
    const skillDiff = computeSkillDiff(localSkills, remoteState.skills);
    const hookDiff = computeHookDiff(localHooks, remoteState.hooks);

    // Check description change
    const descriptionChanged =
      localPluginJson?.description !== undefined &&
      remoteState.plugin_json?.description !== undefined &&
      localPluginJson.description !== remoteState.plugin_json.description;

    // Determine drift status
    let driftStatus: DriftStatus = "unknown";
    if (install.gitCommitSha && remoteState.commit_sha) {
      driftStatus =
        install.gitCommitSha === remoteState.commit_sha ? "current" : "behind";
    }

    if (skillDiff.added.length > 0) {
      warnings.push(
        `New skills added upstream: ${skillDiff.added.join(", ")}`
      );
    }
    if (skillDiff.removed.length > 0) {
      warnings.push(
        `Skills removed upstream: ${skillDiff.removed.join(", ")}`
      );
    }
    if (hookDiff.added.length > 0) {
      warnings.push(
        `New hooks added upstream: ${hookDiff.added.join(", ")}`
      );
    }
    if (hookDiff.removed.length > 0) {
      warnings.push(
        `Hooks removed upstream: ${hookDiff.removed.join(", ")}`
      );
    }
    if (descriptionChanged) {
      warnings.push("Plugin description changed since install");
    }

    // -- Permission escalation analysis --
    let permissionEscalation: PermissionEscalationSummary | null = null;
    if (options?.deep !== false) {
      const localSurface = await buildLocalPermissionSurface(install.installPath);
      // Build remote surface from remote skill contents (fetch SKILL.md files)
      const remoteSkillContents = await fetchRemoteSkillContents(
        resolved.repo,
        repoStatus.default_branch ?? "main",
        pluginPath,
        remoteState.skills
      );
      if (remoteSkillContents.size > 0) {
        const { buildPermissionSurfaceFromContent } = await import("./permissions.js");
        const remoteSurface = buildPermissionSurfaceFromContent(remoteSkillContents);
        const escalations = detectEscalations(localSurface, remoteSurface);

        if (escalations.length > 0) {
          for (const esc of escalations) {
            warnings.push(`Permission escalation: ${esc.detail}`);
          }
        }

        permissionEscalation = {
          escalations,
          local_max_risk: localSurface.max_risk,
          remote_max_risk: remoteSurface.max_risk,
        };
      }
    }

    // -- File integrity analysis --
    let integrity: IntegritySummary | null = null;
    if (options?.deep !== false) {
      const localHashes = await hashLocalFiles(install.installPath);
      const remoteHashes = await hashRemoteFiles(
        resolved.repo,
        repoStatus.default_branch ?? "main",
        pluginPath
      );

      if (remoteHashes.size > 0) {
        const comparison = compareHashes(localHashes, remoteHashes);
        const modified = comparison.content_diffs
          .filter((d) => d.type === "modified")
          .map((d) => d.path);

        if (modified.length > 0) {
          warnings.push(
            `${modified.length} file(s) modified upstream: ${modified.slice(0, 3).join(", ")}${modified.length > 3 ? ` (+${modified.length - 3} more)` : ""}`
          );
        }
        if (comparison.new_scripts_upstream.length > 0) {
          warnings.push(
            `New scripts added upstream: ${comparison.new_scripts_upstream.join(", ")}`
          );
        }

        // Local tampering: compare local against installed SHA
        let tamperedFiles: string[] = [];
        if (install.gitCommitSha) {
          const installedHashes = await hashRemoteFiles(
            resolved.repo,
            install.gitCommitSha,
            pluginPath
          );
          if (installedHashes.size > 0) {
            const tamperCheck = compareHashes(localHashes, installedHashes);
            tamperedFiles = tamperCheck.content_diffs
              .filter((d) => d.type === "modified")
              .map((d) => d.path);
            if (tamperedFiles.length > 0) {
              warnings.push(
                `LOCAL TAMPERING: ${tamperedFiles.length} file(s) differ from installed SHA: ${tamperedFiles.join(", ")}`
              );
            }
          }
        }

        integrity = {
          scripts_checked: comparison.scripts_checked,
          skills_checked: comparison.skills_checked,
          modified_files: modified,
          new_scripts_upstream: comparison.new_scripts_upstream,
          removed_scripts_upstream: comparison.removed_scripts_upstream,
          tampered_files: tamperedFiles,
        };
      }
    }

    // -- Dependency scanning --
    let depScan: DepScanSummary | null = null;
    const depResult = await scanPluginDeps(install.installPath);
    if (depResult.has_bundled_deps) {
      warnings.push(...depResult.warnings);
      depScan = {
        has_bundled_deps: true,
        manifests: depResult.bundled_deps.map((d) => d.manifest),
        dep_warnings: depResult.warnings,
      };
    }

    reports.push({
      plugin_name: pluginName,
      marketplace: resolved.marketplace,
      repo: resolved.repo,
      installed_version: install.version,
      installed_at: install.installedAt,
      last_updated: install.lastUpdated,
      installed_sha: install.gitCommitSha ?? null,
      repo_status: repoStatus,
      drift_status: driftStatus,
      current_sha: remoteState.commit_sha,
      skill_diff: skillDiff,
      hook_diff: hookDiff,
      description_changed: descriptionChanged,
      permission_escalation: permissionEscalation,
      integrity,
      dep_scan: depScan,
      warnings,
    });
  }

  const pluginsWithIssues = reports.filter(
    (r) => r.warnings.length > 0 || r.drift_status === "behind" || !r.repo_status.exists
  ).length;

  return {
    checked_at: new Date().toISOString(),
    plugins_checked: reports.length,
    plugins_with_issues: pluginsWithIssues,
    plugins: reports,
    errors,
  };
}

/**
 * Fetch SKILL.md content for each skill from GitHub.
 */
async function fetchRemoteSkillContents(
  repo: string,
  branch: string,
  pluginPath: string,
  skillNames: string[]
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "cc-sc-verify",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  for (const skill of skillNames) {
    const skillPath = pluginPath
      ? `${pluginPath}/skills/${skill}/SKILL.md`
      : `skills/${skill}/SKILL.md`;
    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/contents/${skillPath}?ref=${branch}`,
        { headers }
      );
      if (!response.ok) continue;
      const blob = (await response.json()) as { content: string };
      if (blob.content) {
        contents.set(
          skill,
          Buffer.from(blob.content, "base64").toString("utf-8")
        );
      }
    } catch {
      // Skip unreachable skills
    }
  }

  return contents;
}

/**
 * Detect the plugin path within a repo.
 * Monorepo pattern: plugins/<name>/
 * Single-plugin pattern: root (empty string)
 */
async function detectPluginPath(
  repo: string,
  branch: string,
  pluginName: string
): Promise<string> {
  // Try monorepo path first: plugins/<name>/
  const monorepoPath = `plugins/${pluginName}`;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${monorepoPath}/.claude-plugin/plugin.json?ref=${branch}`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "cc-sc-verify",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
      }
    );
    if (response.ok) return monorepoPath;
  } catch {
    // Fall through
  }

  // Fall back to root
  return "";
}

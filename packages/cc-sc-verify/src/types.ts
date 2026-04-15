/**
 * Types for Claude Code plugin supply chain verification.
 */

// -- Plugin storage types (from ~/.claude/plugins/) --

export interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, PluginInstall[]>;
}

export interface PluginInstall {
  scope: "user" | "project";
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha?: string;
}

export interface KnownMarketplacesFile {
  [marketplaceName: string]: MarketplaceEntry;
}

export interface MarketplaceEntry {
  source: {
    source: "github";
    repo: string;
  };
  installLocation: string;
  lastUpdated: string;
}

// -- Cached plugin content --

export interface CachedPluginJson {
  name: string;
  description?: string;
  author?: {
    name?: string;
    email?: string;
  };
  [key: string]: unknown;
}

export interface CachedSkill {
  name: string;
  path: string;
}

export interface CachedHook {
  event: string;
  matcher?: string;
  command: string;
}

// -- GitHub API types --

export interface RepoStatus {
  exists: boolean;
  archived: boolean;
  visibility: string | null;
  default_branch: string | null;
  owner_changed: boolean;
  current_owner: string | null;
  original_owner: string | null;
  error?: string;
}

export interface RemotePluginState {
  plugin_json: CachedPluginJson | null;
  skills: string[];
  hooks: string[];
  commit_sha: string | null;
  error?: string;
}

// -- Verification report types --

export type DriftStatus = "current" | "behind" | "unknown";

export interface SkillDiff {
  added: string[];
  removed: string[];
}

export interface HookDiff {
  added: string[];
  removed: string[];
}

export interface PermissionEscalationSummary {
  escalations: Array<{
    skill: string;
    added_tools: string[];
    removed_tools: string[];
    risk_delta: number;
    detail: string;
  }>;
  local_max_risk: number;
  remote_max_risk: number;
}

export interface IntegritySummary {
  scripts_checked: number;
  skills_checked: number;
  modified_files: string[];
  new_scripts_upstream: string[];
  removed_scripts_upstream: string[];
  tampered_files: string[];
}

export interface DepScanSummary {
  has_bundled_deps: boolean;
  manifests: string[];
  dep_warnings: string[];
}

export interface PluginReport {
  plugin_name: string;
  marketplace: string;
  repo: string;
  installed_version: string;
  installed_at: string;
  last_updated: string;
  installed_sha: string | null;
  repo_status: RepoStatus;
  drift_status: DriftStatus;
  current_sha: string | null;
  skill_diff: SkillDiff;
  hook_diff: HookDiff;
  description_changed: boolean;
  permission_escalation: PermissionEscalationSummary | null;
  integrity: IntegritySummary | null;
  dep_scan: DepScanSummary | null;
  warnings: string[];
}

export interface VerificationReport {
  checked_at: string;
  plugins_checked: number;
  plugins_with_issues: number;
  plugins: PluginReport[];
  errors: string[];
}

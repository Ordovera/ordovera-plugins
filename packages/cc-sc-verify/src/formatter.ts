/**
 * Terminal output formatter for verification reports.
 */

import type { PluginReport, VerificationReport } from "./types.js";

function padRight(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

function statusIcon(report: PluginReport): string {
  if (!report.repo_status.exists) return "[MISSING]";
  if (report.repo_status.archived) return "[ARCHIVED]";
  if (report.repo_status.owner_changed) return "[TRANSFERRED]";
  if (report.drift_status === "behind") return "[BEHIND]";
  if (report.warnings.length > 0) return "[WARNING]";
  return "[OK]";
}

function formatPlugin(report: PluginReport): string {
  const lines: string[] = [];
  const status = statusIcon(report);

  lines.push(`${status} ${report.plugin_name} (${report.marketplace})`);
  lines.push(`  Repo: ${report.repo}`);
  lines.push(`  Installed: ${report.installed_at.slice(0, 10)} | Last updated: ${report.last_updated.slice(0, 10)}`);

  if (report.installed_sha && report.current_sha) {
    const match = report.installed_sha === report.current_sha ? "current" : "BEHIND";
    lines.push(`  SHA: ${report.installed_sha.slice(0, 12)} -> ${report.current_sha.slice(0, 12)} (${match})`);
  } else if (report.installed_sha) {
    lines.push(`  SHA: ${report.installed_sha.slice(0, 12)} (remote unknown)`);
  }

  if (report.skill_diff.added.length > 0) {
    lines.push(`  Skills added upstream: ${report.skill_diff.added.join(", ")}`);
  }
  if (report.skill_diff.removed.length > 0) {
    lines.push(`  Skills removed upstream: ${report.skill_diff.removed.join(", ")}`);
  }
  if (report.hook_diff.added.length > 0) {
    lines.push(`  Hooks added upstream: ${report.hook_diff.added.join(", ")}`);
  }
  if (report.hook_diff.removed.length > 0) {
    lines.push(`  Hooks removed upstream: ${report.hook_diff.removed.join(", ")}`);
  }
  if (report.description_changed) {
    lines.push(`  Plugin description changed since install`);
  }

  // Permission escalation
  if (report.permission_escalation?.escalations.length) {
    for (const esc of report.permission_escalation.escalations) {
      lines.push(`  PERMISSION: ${esc.detail}`);
    }
  }

  // Integrity
  if (report.integrity) {
    if (report.integrity.tampered_files.length > 0) {
      lines.push(`  TAMPERED: ${report.integrity.tampered_files.join(", ")}`);
    }
    if (report.integrity.modified_files.length > 0) {
      lines.push(
        `  Modified upstream: ${report.integrity.modified_files.slice(0, 5).join(", ")}${report.integrity.modified_files.length > 5 ? ` (+${report.integrity.modified_files.length - 5} more)` : ""}`
      );
    }
    if (report.integrity.new_scripts_upstream.length > 0) {
      lines.push(`  New scripts upstream: ${report.integrity.new_scripts_upstream.join(", ")}`);
    }
  }

  // Bundled deps
  if (report.dep_scan?.has_bundled_deps) {
    lines.push(`  Bundled deps: ${report.dep_scan.manifests.join(", ")}`);
  }

  // Dep audit findings
  if (report.dep_audit && report.dep_audit.findings.length > 0) {
    for (const f of report.dep_audit.findings) {
      const parts: string[] = [`${f.package_name}@${f.version}`];
      if (f.vuln_count > 0) parts.push(`${f.vuln_count} CVE(s) [${f.highest_severity}]`);
      if (f.deprecated) parts.push("DEPRECATED");
      lines.push(`  DEP: ${parts.join(" -- ")}`);
    }
  }

  // Skipped analysis reasons (only show for non-obvious cases)
  if (report.skipped) {
    for (const [field, reason] of Object.entries(report.skipped)) {
      // Don't show "no bundled deps" or "not requested" -- those are expected
      if (reason.includes("rate-limited") || reason.includes("not available")) {
        lines.push(`  SKIPPED ${field}: ${reason}`);
      }
    }
  }

  // Remaining warnings not already shown
  const shownPrefixes = [
    "New skills", "Skills removed", "New hooks", "Hooks removed",
    "Plugin description", "Permission escalation", "LOCAL TAMPERING",
    "file(s) modified upstream", "New scripts added upstream",
  ];
  for (const warning of report.warnings) {
    if (!shownPrefixes.some((p) => warning.startsWith(p)) &&
        !warning.includes("dependencies in") &&
        !warning.includes("bundles node_modules") &&
        !warning.includes("no lockfile")) {
      lines.push(`  WARNING: ${warning}`);
    }
  }

  return lines.join("\n");
}

export function formatTerminal(report: VerificationReport): string {
  const lines: string[] = [];

  lines.push("Plugin Supply Chain Verification");
  lines.push("================================");
  lines.push(`Checked: ${report.checked_at.slice(0, 19).replace("T", " ")} UTC`);
  lines.push(`Plugins: ${report.plugins_checked} checked, ${report.plugins_with_issues} with issues`);
  lines.push("");

  if (report.errors.length > 0) {
    lines.push("Errors:");
    for (const err of report.errors) {
      lines.push(`  - ${err}`);
    }
    lines.push("");
  }

  // Group by marketplace
  const byMarketplace = new Map<string, PluginReport[]>();
  for (const plugin of report.plugins) {
    const group = byMarketplace.get(plugin.marketplace) ?? [];
    group.push(plugin);
    byMarketplace.set(plugin.marketplace, group);
  }

  for (const [marketplace, plugins] of byMarketplace) {
    lines.push(`--- ${marketplace} ---`);
    lines.push("");
    for (const plugin of plugins) {
      lines.push(formatPlugin(plugin));
      lines.push("");
    }
  }

  // Summary
  const missing = report.plugins.filter((p) => !p.repo_status.exists);
  const archived = report.plugins.filter((p) => p.repo_status.archived);
  const behind = report.plugins.filter((p) => p.drift_status === "behind");
  const transferred = report.plugins.filter((p) => p.repo_status.owner_changed);

  if (missing.length + archived.length + behind.length + transferred.length > 0) {
    lines.push("Summary");
    lines.push("-------");
    if (missing.length > 0)
      lines.push(`  Missing repos: ${missing.map((p) => p.plugin_name).join(", ")}`);
    if (archived.length > 0)
      lines.push(`  Archived repos: ${archived.map((p) => p.plugin_name).join(", ")}`);
    if (transferred.length > 0)
      lines.push(`  Transferred repos: ${transferred.map((p) => p.plugin_name).join(", ")}`);
    if (behind.length > 0)
      lines.push(`  Behind upstream: ${behind.map((p) => p.plugin_name).join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

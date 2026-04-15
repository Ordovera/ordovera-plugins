/**
 * Permission surface analysis for SKILL.md files.
 *
 * Parses skill files for tool references (Bash, Write, Edit, MCP calls, etc.)
 * to build a permission profile. Compares local vs. remote to detect
 * permission escalation -- a skill that used to only Read now calling Bash.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Tools ordered by risk level (higher = more dangerous)
const TOOL_RISK: Record<string, number> = {
  Bash: 5,
  Write: 4,
  Edit: 4,
  NotebookEdit: 4,
  Agent: 3,
  Glob: 1,
  Grep: 1,
  Read: 1,
};

// Patterns that indicate tool usage in SKILL.md content
const TOOL_PATTERNS: Array<{ name: string; patterns: RegExp[] }> = [
  {
    name: "Bash",
    patterns: [
      /\bbash\b/i,
      /\bBash\s+tool\b/,
      /`Bash`/,
      /\bshell\s+command/i,
      /\brun\b.*\bcommand\b/i,
    ],
  },
  {
    name: "Write",
    patterns: [/\bWrite\s+tool\b/, /`Write`/, /\bwrite\s+file/i],
  },
  {
    name: "Edit",
    patterns: [/\bEdit\s+tool\b/, /`Edit`/, /\bedit\s+file/i],
  },
  {
    name: "Read",
    patterns: [/\bRead\s+tool\b/, /`Read`/, /\bread\s+file/i],
  },
  {
    name: "Agent",
    patterns: [/\bAgent\s+tool\b/, /`Agent`/, /\bsub-?agent/i, /\bspawn.*agent/i],
  },
  {
    name: "MCP",
    patterns: [/\bmcp__/, /\bMCP\s+tool/i, /\bMCP\s+server/i],
  },
  {
    name: "Grep",
    patterns: [/`Grep`/, /\bGrep\s+tool\b/],
  },
  {
    name: "Glob",
    patterns: [/`Glob`/, /\bGlob\s+tool\b/],
  },
];

export interface PermissionProfile {
  skill: string;
  tools_referenced: string[];
  max_risk: number;
}

export interface PermissionEscalation {
  skill: string;
  added_tools: string[];
  removed_tools: string[];
  risk_delta: number;
  detail: string;
}

export interface PermissionSurface {
  profiles: PermissionProfile[];
  total_tools: string[];
  max_risk: number;
}

function extractToolReferences(content: string): string[] {
  const found = new Set<string>();
  for (const { name, patterns } of TOOL_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        found.add(name);
        break;
      }
    }
  }
  return Array.from(found).sort();
}

function maxRisk(tools: string[]): number {
  let max = 0;
  for (const tool of tools) {
    const risk = TOOL_RISK[tool] ?? 2; // Unknown tools get moderate risk
    if (risk > max) max = risk;
  }
  return max;
}

export async function buildLocalPermissionSurface(
  installPath: string
): Promise<PermissionSurface> {
  const skillsDir = join(installPath, "skills");
  if (!existsSync(skillsDir)) {
    return { profiles: [], total_tools: [], max_risk: 0 };
  }

  const profiles: PermissionProfile[] = [];
  const allTools = new Set<string>();

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;

      const content = await readFile(skillMdPath, "utf-8");
      const tools = extractToolReferences(content);
      tools.forEach((t) => allTools.add(t));

      profiles.push({
        skill: entry.name,
        tools_referenced: tools,
        max_risk: maxRisk(tools),
      });
    }
  } catch {
    // Skills directory unreadable
  }

  return {
    profiles,
    total_tools: Array.from(allTools).sort(),
    max_risk: maxRisk(Array.from(allTools)),
  };
}

export function buildPermissionSurfaceFromContent(
  skillContents: Map<string, string>
): PermissionSurface {
  const profiles: PermissionProfile[] = [];
  const allTools = new Set<string>();

  for (const [skill, content] of skillContents) {
    const tools = extractToolReferences(content);
    tools.forEach((t) => allTools.add(t));
    profiles.push({
      skill,
      tools_referenced: tools,
      max_risk: maxRisk(tools),
    });
  }

  return {
    profiles,
    total_tools: Array.from(allTools).sort(),
    max_risk: maxRisk(Array.from(allTools)),
  };
}

export function detectEscalations(
  local: PermissionSurface,
  remote: PermissionSurface
): PermissionEscalation[] {
  const escalations: PermissionEscalation[] = [];
  const localBySkill = new Map(local.profiles.map((p) => [p.skill, p]));
  const remoteBySkill = new Map(remote.profiles.map((p) => [p.skill, p]));

  // Check existing skills for permission changes
  for (const [skill, localProfile] of localBySkill) {
    const remoteProfile = remoteBySkill.get(skill);
    if (!remoteProfile) continue;

    const localSet = new Set(localProfile.tools_referenced);
    const remoteSet = new Set(remoteProfile.tools_referenced);

    const added = remoteProfile.tools_referenced.filter((t) => !localSet.has(t));
    const removed = localProfile.tools_referenced.filter((t) => !remoteSet.has(t));

    if (added.length > 0 || removed.length > 0) {
      const riskDelta = remoteProfile.max_risk - localProfile.max_risk;
      const details: string[] = [];
      if (added.length > 0) details.push(`now uses ${added.join(", ")}`);
      if (removed.length > 0) details.push(`no longer uses ${removed.join(", ")}`);

      escalations.push({
        skill,
        added_tools: added,
        removed_tools: removed,
        risk_delta: riskDelta,
        detail: `${skill}: ${details.join("; ")}${riskDelta > 0 ? ` (risk increased by ${riskDelta})` : ""}`,
      });
    }
  }

  // Check new skills (not in local) for high-risk tool usage
  for (const [skill, remoteProfile] of remoteBySkill) {
    if (localBySkill.has(skill)) continue;
    if (remoteProfile.max_risk >= 4) {
      escalations.push({
        skill,
        added_tools: remoteProfile.tools_referenced,
        removed_tools: [],
        risk_delta: remoteProfile.max_risk,
        detail: `New skill "${skill}" uses high-risk tools: ${remoteProfile.tools_referenced.filter((t) => (TOOL_RISK[t] ?? 0) >= 4).join(", ")}`,
      });
    }
  }

  return escalations.sort((a, b) => b.risk_delta - a.risk_delta);
}

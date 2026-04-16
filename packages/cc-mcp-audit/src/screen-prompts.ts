import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Domain5Indicator } from "./types.js";

export const PROMPT_VERSION = "v1";

const PROMPT_FILES: Record<Domain5Indicator, string> = {
  selfModificationPrevention: "domain5_self_modification.txt",
  subAgentAuthorityConstraints: "domain5_sub_agent_authority.txt",
  permissionBoundaryEnforcement: "domain5_permission_boundary.txt",
};

/**
 * Resolve the prompts directory relative to this module's runtime location.
 * At build time, src/ compiles to dist/; the prompts live at package root in
 * prompts/<version>/. Walk up from dist/ (or src/ in tests) to package root.
 */
function promptsDir(version: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // From dist/ -> package root; from src/ -> package root. Either way, "..".
  return resolve(here, "..", "prompts", version);
}

// Cache loaded prompts so each indicator's template is read only once
const TEMPLATE_CACHE: Partial<Record<Domain5Indicator, string>> = {};

function loadTemplate(indicator: Domain5Indicator): string {
  const cached = TEMPLATE_CACHE[indicator];
  if (cached != null) return cached;

  const filename = PROMPT_FILES[indicator];
  const path = join(promptsDir(PROMPT_VERSION), filename);
  const content = readFileSync(path, "utf-8");
  TEMPLATE_CACHE[indicator] = content;
  return content;
}

/**
 * Build a prompt string for the given Domain 5 indicator and extracted code regions.
 * Loads the versioned template from `prompts/<PROMPT_VERSION>/` and substitutes
 * the `{{REGIONS}}` placeholder.
 */
export function buildPrompt(
  indicator: Domain5Indicator,
  regionsText: string
): string {
  const template = loadTemplate(indicator);
  return template.replace("{{REGIONS}}", regionsText);
}

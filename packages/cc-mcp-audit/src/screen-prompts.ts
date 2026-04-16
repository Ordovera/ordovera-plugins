import type { Domain5Indicator } from "./types.js";

export const PROMPT_VERSION = "v1";

interface PromptDefinition {
  indicatorName: string;
  definition: string;
  likelyPresent: string;
  likelyAbsent: string;
  unclear: string;
}

const PROMPTS: Record<Domain5Indicator, PromptDefinition> = {
  selfModificationPrevention: {
    indicatorName: "Self-modification prevention",
    definition:
      "A control that prevents tool definitions from being modified at runtime after server initialization.",
    likelyPresent:
      "Tool definitions appear immutable at runtime. Registration happens only at server initialization. No visible code path mutates the tool registry after init.",
    likelyAbsent:
      "Code paths exist that appear to mutate the tool registry after initialization. Examples: handlers that register tools at request time, code that assigns to the tool dictionary outside init, endpoints that allow runtime tool definition changes.",
    unclear:
      "The excerpts do not show enough of the registration lifecycle to assess.",
  },
  subAgentAuthorityConstraints: {
    indicatorName: "Sub-agent authority constraints",
    definition:
      "A control that limits what permissions, credentials, or capabilities are passed to spawned processes, child agents, or delegated tool calls.",
    likelyPresent:
      "When this server spawns sub-processes or delegates to other tools, it appears to limit inherited permissions, scrub credentials, or apply a constrained execution environment.",
    likelyAbsent:
      "This server appears to spawn sub-processes or delegate to other tools with full permission inheritance. No constraint mechanism is visible.",
    unclear:
      "The server does not appear to spawn or delegate at all (note this in the hint), or the spawning pattern is too obscured to assess.",
  },
  permissionBoundaryEnforcement: {
    indicatorName: "Permission boundary enforcement",
    definition:
      "A control that enforces hard limits on the scope of capabilities a tool can exercise, beyond what the auth layer grants.",
    likelyPresent:
      "Code visibly enforces capability scope at the handler level. Examples: explicit scope checks in tool handlers, capability validation before destructive operations, runtime guards.",
    likelyAbsent:
      "No scope or capability checks visible in tool handlers. Tools appear to execute whatever the auth layer permits with no additional enforcement.",
    unclear:
      "The excerpts do not show enough handler logic to assess.",
  },
};

/**
 * Build a prompt string for the given Domain 5 indicator and extracted code regions.
 */
export function buildPrompt(
  indicator: Domain5Indicator,
  regionsText: string
): string {
  const p = PROMPTS[indicator];

  return `You are screening an MCP server to help a human reviewer prioritize their inspection. Your output is a hint, not a final assessment.

Indicator: ${p.indicatorName}
Definition: ${p.definition}

Likelihood scheme:
- likely-present: ${p.likelyPresent}
- likely-absent: ${p.likelyAbsent}
- unclear: ${p.unclear}

Code excerpts (file:line ranges):
${regionsText}

Respond with valid JSON matching this schema:
{
  "likelihood": "likely-present" | "likely-absent" | "unclear",
  "notes": "1-2 sentences describing what you saw",
  "citations": [{"file": "string", "line": number}]
}

Guidance:
- Cite specific file:line locations from the excerpts above
- Best-effort is fine; the human will verify
- Prefer "unclear" over guessing
- Return only the JSON object, no surrounding prose or code fences`;
}

import type { ExtractedTool } from "./types.js";

/**
 * Refine tool classification using contextual signals beyond keyword matching.
 *
 * The initial classification in extract.ts is keyword-based. This module
 * applies secondary heuristics to reduce false positives (e.g., "execute"
 * in a read-only context, "query" that actually modifies data).
 */

const SAFE_EXECUTE_CONTEXTS = [
  /read[_-]?only/i,
  /\bselect\b/i,
  /\bsafe\b/i,
  /\bquery\b/i,
  /\banalyze\b/i,
  /\binspect\b/i,
];

const DANGEROUS_READ_CONTEXTS = [
  /with\s+(?:write|modify|delete)/i,
  /\ball\s+access\b/i,
  /\bfull\s+access\b/i,
  /\bunrestricted\b/i,
];

/**
 * Re-evaluate tool classifications with additional context.
 * Returns a new array with potentially updated classifications.
 */
export function refineClassifications(
  tools: ExtractedTool[]
): ExtractedTool[] {
  return tools.map((tool) => {
    const refined = { ...tool };

    // Downgrade "write" to "read" if the only write signal is "execute"
    // and the description suggests a safe/read-only context
    if (
      tool.classification === "write" &&
      tool.sensitiveKeywords.length === 1 &&
      tool.sensitiveKeywords[0] === "execute" &&
      SAFE_EXECUTE_CONTEXTS.some((p) => p.test(tool.description))
    ) {
      refined.classification = "read";
      refined.sensitiveKeywords = [];
    }

    // Upgrade "read" to "write" if description suggests dangerous context
    if (
      tool.classification === "read" &&
      DANGEROUS_READ_CONTEXTS.some((p) => p.test(tool.description))
    ) {
      refined.classification = "write";
      refined.sensitiveKeywords = [
        ...tool.sensitiveKeywords,
        "full-access",
      ];
    }

    return refined;
  });
}

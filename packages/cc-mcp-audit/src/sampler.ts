/**
 * Stratified random sampler derived from a corpus of MCP servers.
 *
 * Draws a reproducible sample of 160 MCP servers from the canonical snapshot
 * across 6 strata defined by package ecosystem and MCP Registry presence.
 *
 * Strata:
 *   1. npm + MCP Registry        (target: 30)
 *   2. npm only                  (target: 35)
 *   3. pypi + MCP Registry       (target: 25)
 *   4. pypi only                 (target: 25)
 *   5. other ecosystems          (target: 15)  -- oci, mcpb, nuget
 *   6. remote-only (no source)   (target: 30)
 */

import type { CanonicalCandidate, CanonicalSnapshot } from "./discover-registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StratumDefinition {
  name: string;
  targetN: number;
  filter: (c: CanonicalCandidate) => boolean;
}

export interface SampledServer {
  /** Which stratum this was drawn from */
  stratum: string;
  /** The candidate record from the snapshot */
  candidate: CanonicalCandidate;
}

export interface SampleResult {
  /** Snapshot date the sample was drawn from */
  snapshotDate: string;
  /** When the sample was drawn */
  sampledAt: string;
  /** RNG seed used (for reproducibility) */
  seed: number;
  /** Total sample size */
  totalN: number;
  /** Per-stratum breakdown */
  strata: Array<{
    name: string;
    populationSize: number;
    targetN: number;
    actualN: number;
  }>;
  /** The drawn sample */
  servers: SampledServer[];
}

// ---------------------------------------------------------------------------
// Stratum definitions
// ---------------------------------------------------------------------------

function hasRegistrySource(c: CanonicalCandidate): boolean {
  return c.sources.some((s) => s.type === "mcp-registry");
}

function hasNpmSource(c: CanonicalCandidate): boolean {
  return c.packageEcosystems.includes("npm");
}

function hasPypiSource(c: CanonicalCandidate): boolean {
  return c.packageEcosystems.includes("pypi");
}

function hasOtherEcosystem(c: CanonicalCandidate): boolean {
  return c.packageEcosystems.some((e) =>
    e === "oci" || e === "mcpb" || e === "nuget"
  );
}

function isRemoteOnly(c: CanonicalCandidate): boolean {
  return c.repositoryUrl === null;
}

export const STRATA: StratumDefinition[] = [
  {
    name: "npm+registry",
    targetN: 30,
    filter: (c) => hasNpmSource(c) && hasRegistrySource(c) && !isRemoteOnly(c),
  },
  {
    name: "npm-only",
    targetN: 35,
    filter: (c) => hasNpmSource(c) && !hasRegistrySource(c) && !isRemoteOnly(c),
  },
  {
    name: "pypi+registry",
    targetN: 25,
    filter: (c) => hasPypiSource(c) && hasRegistrySource(c) && !isRemoteOnly(c),
  },
  {
    name: "pypi-only",
    targetN: 25,
    filter: (c) => hasPypiSource(c) && !hasRegistrySource(c) && !isRemoteOnly(c),
  },
  {
    name: "other-ecosystem",
    targetN: 15,
    filter: (c) =>
      !isRemoteOnly(c) &&
      (hasOtherEcosystem(c) ||
        // Catch registry-only servers that have a repo but aren't in npm/pypi
        (hasRegistrySource(c) && !hasNpmSource(c) && !hasPypiSource(c) && c.repositoryUrl !== null)),
  },
  {
    name: "remote-only",
    targetN: 30,
    filter: (c) => isRemoteOnly(c) && hasRegistrySource(c),
  },
];

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle with seeded PRNG.
 */
function shuffleSeeded<T>(arr: T[], rng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sampler
// ---------------------------------------------------------------------------

/**
 * Draw a stratified random sample from a canonical snapshot.
 *
 * @param snapshot - The canonical snapshot to sample from
 * @param seed - RNG seed for reproducibility (default: 20260504)
 * @param strata - Stratum definitions (default: STRATA)
 * @returns SampleResult with the drawn sample
 */
export function drawSample(
  snapshot: CanonicalSnapshot,
  seed = 20260504,
  strata: StratumDefinition[] = STRATA
): SampleResult {
  const rng = mulberry32(seed);
  const servers: SampledServer[] = [];
  const strataResults: SampleResult["strata"] = [];

  // Track which candidates have been assigned to prevent double-counting
  const assigned = new Set<string>();

  for (const stratum of strata) {
    // Filter candidates for this stratum, excluding already-assigned
    const eligible = snapshot.candidates.filter(
      (c) => stratum.filter(c) && !assigned.has(c.key)
    );

    // Shuffle and take targetN
    const shuffled = shuffleSeeded(eligible, rng);
    const drawn = shuffled.slice(0, stratum.targetN);

    for (const c of drawn) {
      assigned.add(c.key);
      servers.push({ stratum: stratum.name, candidate: c });
    }

    strataResults.push({
      name: stratum.name,
      populationSize: eligible.length,
      targetN: stratum.targetN,
      actualN: drawn.length,
    });
  }

  return {
    snapshotDate: snapshot.snapshotDate,
    sampledAt: new Date().toISOString(),
    seed,
    totalN: servers.length,
    strata: strataResults,
    servers,
  };
}

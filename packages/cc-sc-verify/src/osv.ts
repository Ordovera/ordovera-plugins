/**
 * OSV.dev API client for checking dependencies against known vulnerabilities.
 *
 * OSV is a free, ecosystem-agnostic vulnerability database that covers
 * npm, PyPI, crates.io, Go, NuGet, RubyGems, and Packagist.
 * No authentication required.
 *
 * https://osv.dev/docs/
 */

const OSV_API = "https://api.osv.dev/v1";

export interface OsvVulnerability {
  id: string;
  summary: string;
  severity: string;
  aliases: string[];
  affected_package: string;
  affected_version: string;
  fixed_version: string | null;
  reference_url: string | null;
}

export interface DepAuditResult {
  package_name: string;
  version: string;
  ecosystem: string;
  deprecated: boolean;
  deprecation_message: string | null;
  vulnerabilities: OsvVulnerability[];
}

export interface DepAuditReport {
  deps_checked: number;
  deps_with_vulns: number;
  deps_deprecated: number;
  total_vulns: number;
  results: DepAuditResult[];
}

interface OsvQueryResponse {
  vulns?: Array<{
    id: string;
    summary?: string;
    severity?: Array<{ type: string; score: string }>;
    aliases?: string[];
    affected?: Array<{
      package?: { name: string; ecosystem: string };
      ranges?: Array<{
        type: string;
        events: Array<{ introduced?: string; fixed?: string }>;
      }>;
    }>;
    references?: Array<{ type: string; url: string }>;
  }>;
}

const ECOSYSTEM_MAP: Record<string, string> = {
  npm: "npm",
  pip: "PyPI",
  "pip/poetry": "PyPI",
  pipenv: "PyPI",
  cargo: "crates.io",
  go: "Go",
  bundler: "RubyGems",
  nuget: "NuGet",
  composer: "Packagist",
};

function mapEcosystem(packageManager: string): string {
  return ECOSYSTEM_MAP[packageManager] ?? packageManager;
}

async function queryOsv(
  packageName: string,
  version: string,
  ecosystem: string
): Promise<OsvVulnerability[]> {
  try {
    const response = await fetch(`${OSV_API}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: { name: packageName, ecosystem },
        version,
      }),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as OsvQueryResponse;
    if (!data.vulns || data.vulns.length === 0) return [];

    return data.vulns.map((vuln) => {
      // Extract severity
      let severity = "UNKNOWN";
      if (vuln.severity && vuln.severity.length > 0) {
        const cvss = vuln.severity.find((s) => s.type === "CVSS_V3");
        if (cvss) {
          const score = parseFloat(cvss.score);
          if (score >= 9.0) severity = "CRITICAL";
          else if (score >= 7.0) severity = "HIGH";
          else if (score >= 4.0) severity = "MEDIUM";
          else severity = "LOW";
        }
      }

      // Extract fixed version
      let fixedVersion: string | null = null;
      if (vuln.affected) {
        for (const affected of vuln.affected) {
          for (const range of affected.ranges ?? []) {
            for (const event of range.events) {
              if (event.fixed) {
                fixedVersion = event.fixed;
              }
            }
          }
        }
      }

      // Extract reference URL
      let referenceUrl: string | null = null;
      if (vuln.references && vuln.references.length > 0) {
        const advisory = vuln.references.find((r) => r.type === "ADVISORY");
        referenceUrl = advisory?.url ?? vuln.references[0]?.url ?? null;
      }

      return {
        id: vuln.id,
        summary: vuln.summary ?? vuln.id,
        severity,
        aliases: vuln.aliases ?? [],
        affected_package: packageName,
        affected_version: version,
        fixed_version: fixedVersion,
        reference_url: referenceUrl,
      };
    });
  } catch {
    return [];
  }
}

// -- Registry deprecation checks --

interface NpmRegistryResponse {
  deprecated?: string;
  versions?: Record<string, { deprecated?: string }>;
}

async function checkNpmDeprecation(
  packageName: string,
  version: string
): Promise<{ deprecated: boolean; message: string | null }> {
  try {
    const url = version
      ? `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${version}`
      : `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
    const response = await fetch(url);
    if (!response.ok) return { deprecated: false, message: null };
    const data = (await response.json()) as NpmRegistryResponse;
    if (data.deprecated) {
      return { deprecated: true, message: data.deprecated };
    }
    return { deprecated: false, message: null };
  } catch {
    return { deprecated: false, message: null };
  }
}

interface PypiResponse {
  info?: { yanked?: boolean; yanked_reason?: string };
}

async function checkPypiDeprecation(
  packageName: string,
  version: string
): Promise<{ deprecated: boolean; message: string | null }> {
  try {
    const url = version
      ? `https://pypi.org/pypi/${encodeURIComponent(packageName)}/${version}/json`
      : `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;
    const response = await fetch(url);
    if (!response.ok) return { deprecated: false, message: null };
    const data = (await response.json()) as PypiResponse;
    if (data.info?.yanked) {
      return {
        deprecated: true,
        message: data.info.yanked_reason ?? "Package version yanked",
      };
    }
    return { deprecated: false, message: null };
  } catch {
    return { deprecated: false, message: null };
  }
}

// -- Dependency extraction from manifests --

export interface ExtractedDep {
  name: string;
  version: string;
  ecosystem: string;
}

export function extractNpmDeps(packageJson: Record<string, unknown>): ExtractedDep[] {
  const deps: ExtractedDep[] = [];
  const allDeps = {
    ...(packageJson.dependencies as Record<string, string> ?? {}),
    ...(packageJson.devDependencies as Record<string, string> ?? {}),
  };
  for (const [name, versionSpec] of Object.entries(allDeps)) {
    // Strip semver prefixes (^, ~, >=, etc.) to get a usable version
    const version = versionSpec.replace(/^[\^~>=<]+/, "");
    deps.push({ name, version, ecosystem: "npm" });
  }
  return deps;
}

export function extractPipDeps(requirementsTxt: string): ExtractedDep[] {
  const deps: ExtractedDep[] = [];
  for (const line of requirementsTxt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    // Parse "package==1.0.0", "package>=1.0.0", "package"
    const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*(?:[=><~!]+\s*(.+))?/);
    if (match) {
      deps.push({
        name: match[1],
        version: match[2]?.split(",")[0]?.trim() ?? "",
        ecosystem: "PyPI",
      });
    }
  }
  return deps;
}

// -- Main audit function --

export async function auditDeps(
  installPath: string,
  packageManager: string
): Promise<DepAuditReport> {
  const { readFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");

  const results: DepAuditResult[] = [];
  let deps: ExtractedDep[] = [];
  const ecosystem = mapEcosystem(packageManager);

  // Extract deps based on package manager
  if (packageManager === "npm") {
    const pkgPath = join(installPath, "package.json");
    if (existsSync(pkgPath)) {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content);
      deps = extractNpmDeps(pkg);
    }
  } else if (packageManager === "pip" || packageManager === "pip/poetry" || packageManager === "pipenv") {
    const reqPath = join(installPath, "requirements.txt");
    if (existsSync(reqPath)) {
      const content = await readFile(reqPath, "utf-8");
      deps = extractPipDeps(content);
    }
  }
  // Other package managers: could be extended but npm and pip cover the
  // vast majority of plugins that bundle deps

  // Check each dep
  for (const dep of deps) {
    const vulns = dep.version
      ? await queryOsv(dep.name, dep.version, ecosystem)
      : [];

    let deprecation = { deprecated: false, message: null as string | null };
    if (ecosystem === "npm" && dep.version) {
      deprecation = await checkNpmDeprecation(dep.name, dep.version);
    } else if (ecosystem === "PyPI" && dep.version) {
      deprecation = await checkPypiDeprecation(dep.name, dep.version);
    }

    if (vulns.length > 0 || deprecation.deprecated) {
      results.push({
        package_name: dep.name,
        version: dep.version,
        ecosystem,
        deprecated: deprecation.deprecated,
        deprecation_message: deprecation.message,
        vulnerabilities: vulns,
      });
    }
  }

  return {
    deps_checked: deps.length,
    deps_with_vulns: results.filter((r) => r.vulnerabilities.length > 0).length,
    deps_deprecated: results.filter((r) => r.deprecated).length,
    total_vulns: results.reduce((sum, r) => sum + r.vulnerabilities.length, 0),
    results,
  };
}

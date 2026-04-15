/**
 * Plugin dependency scanning.
 *
 * Checks if a plugin bundles its own dependencies (package.json,
 * requirements.txt, etc.) and flags potential supply chain risks
 * from bundled deps.
 *
 * This is NOT a CVE scanner -- that's what npm audit / pip-audit / top10-scan
 * SCA does. This detects the *presence* of bundled deps in plugins, which
 * is itself a supply chain signal: plugins should be stdlib-only. Bundled
 * deps expand the attack surface beyond what the plugin marketplace reviewed.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface BundledDep {
  manifest: string;
  package_manager: string;
  dep_count: number;
  has_lockfile: boolean;
  has_node_modules: boolean;
}

export interface DepScanResult {
  has_bundled_deps: boolean;
  bundled_deps: BundledDep[];
  warnings: string[];
}

const MANIFESTS: Array<{
  file: string;
  manager: string;
  lockfiles: string[];
  modules_dir?: string;
}> = [
  {
    file: "package.json",
    manager: "npm",
    lockfiles: ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"],
    modules_dir: "node_modules",
  },
  {
    file: "requirements.txt",
    manager: "pip",
    lockfiles: [],
  },
  {
    file: "Pipfile",
    manager: "pipenv",
    lockfiles: ["Pipfile.lock"],
  },
  {
    file: "pyproject.toml",
    manager: "pip/poetry",
    lockfiles: ["poetry.lock"],
  },
  {
    file: "Cargo.toml",
    manager: "cargo",
    lockfiles: ["Cargo.lock"],
  },
  {
    file: "Gemfile",
    manager: "bundler",
    lockfiles: ["Gemfile.lock"],
  },
  {
    file: "go.mod",
    manager: "go",
    lockfiles: ["go.sum"],
  },
  {
    file: "composer.json",
    manager: "composer",
    lockfiles: ["composer.lock"],
  },
];

async function countDeps(manifestPath: string, manager: string): Promise<number> {
  try {
    const content = await readFile(manifestPath, "utf-8");

    if (manager === "npm") {
      const pkg = JSON.parse(content);
      const deps = Object.keys(pkg.dependencies ?? {}).length;
      const devDeps = Object.keys(pkg.devDependencies ?? {}).length;
      return deps + devDeps;
    }

    if (manager === "pip") {
      // Count non-empty, non-comment lines
      return content
        .split("\n")
        .filter((l) => l.trim() && !l.trim().startsWith("#"))
        .length;
    }

    // For other manifests, return -1 (unknown count)
    return -1;
  } catch {
    return -1;
  }
}

export async function scanPluginDeps(
  installPath: string
): Promise<DepScanResult> {
  const bundledDeps: BundledDep[] = [];
  const warnings: string[] = [];

  for (const manifest of MANIFESTS) {
    const manifestPath = join(installPath, manifest.file);
    if (!existsSync(manifestPath)) continue;

    const hasLockfile = manifest.lockfiles.some((lf) =>
      existsSync(join(installPath, lf))
    );

    const hasModulesDir = manifest.modules_dir
      ? existsSync(join(installPath, manifest.modules_dir))
      : false;

    const depCount = await countDeps(manifestPath, manifest.manager);

    bundledDeps.push({
      manifest: manifest.file,
      package_manager: manifest.manager,
      dep_count: depCount,
      has_lockfile: hasLockfile,
      has_node_modules: hasModulesDir,
    });

    // Generate warnings
    if (hasModulesDir) {
      warnings.push(
        `Plugin bundles ${manifest.modules_dir}/ -- dependencies are shipped with the plugin, not reviewed by the marketplace`
      );
    }

    if (depCount > 0) {
      const countStr = depCount === -1 ? "unknown number of" : `${depCount}`;
      warnings.push(
        `Plugin declares ${countStr} dependencies in ${manifest.file} (${manifest.manager}). ` +
        `Plugins should prefer stdlib-only scripts. Run \`${getAuditCommand(manifest.manager)}\` to check for CVEs.`
      );
    }

    if (!hasLockfile && depCount > 0) {
      warnings.push(
        `${manifest.file} has dependencies but no lockfile -- versions are not pinned`
      );
    }
  }

  return {
    has_bundled_deps: bundledDeps.length > 0,
    bundled_deps: bundledDeps,
    warnings,
  };
}

function getAuditCommand(manager: string): string {
  switch (manager) {
    case "npm":
      return "npm audit";
    case "pip":
    case "pip/poetry":
    case "pipenv":
      return "pip-audit";
    case "cargo":
      return "cargo audit";
    case "bundler":
      return "bundle-audit";
    case "go":
      return "govulncheck ./...";
    case "composer":
      return "composer audit";
    default:
      return "dependency-check";
  }
}

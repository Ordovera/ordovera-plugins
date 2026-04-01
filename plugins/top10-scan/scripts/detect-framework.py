#!/usr/bin/env python3
"""Detect application frameworks, languages, and package managers in a target directory.

Outputs JSON to stdout with detected frameworks, languages, package manager, and markers found.
Uses only Python 3 standard library.
"""

import argparse
import json
import os
import sys


# Maximum directory depth to traverse
MAX_DEPTH = 3

# Framework detection markers
FRAMEWORK_MARKERS = {
    "nextjs": ["next.config.js", "next.config.ts", "next.config.mjs"],
    "nextjs_layout": ["app/layout.tsx", "app/layout.ts", "app/layout.jsx", "app/layout.js"],
    "django_manage": ["manage.py"],
    "django_settings": ["settings.py"],
    "rails_gemfile": ["Gemfile"],
    "rails_routes": ["config/routes.rb"],
    "go": ["go.mod"],
}

# Language detection by file extension
LANGUAGE_EXTENSIONS = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".java": "java",
    ".kt": "kotlin",
    ".php": "php",
    ".rs": "rust",
    ".cs": "csharp",
}

# Lockfile to package manager mapping
LOCKFILE_MAP = {
    "package-lock.json": "npm",
    "yarn.lock": "yarn",
    "pnpm-lock.yaml": "pnpm",
    "bun.lockb": "bun",
    "Gemfile.lock": "bundler",
    "Pipfile.lock": "pipenv",
    "poetry.lock": "poetry",
    "go.sum": "go",
    "composer.lock": "composer",
    "Cargo.lock": "cargo",
}


def walk_directory(target, max_depth):
    """Walk directory up to max_depth levels, yielding (dirpath, filenames)."""
    target = os.path.abspath(target)
    target_depth = target.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, filenames in os.walk(target):
        current_depth = dirpath.rstrip(os.sep).count(os.sep) - target_depth
        if current_depth >= max_depth:
            dirnames.clear()
            continue
        # Skip hidden directories and common non-project directories
        dirnames[:] = [
            d for d in dirnames
            if not d.startswith(".") and d not in ("node_modules", "__pycache__", "venv", ".venv", "vendor", "target", "build", "dist")
        ]
        yield dirpath, filenames


def find_files(target, max_depth):
    """Collect all file paths relative to target directory."""
    relative_paths = []
    for dirpath, filenames in walk_directory(target, max_depth):
        for filename in filenames:
            full_path = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(full_path, target)
            relative_paths.append(rel_path)
    return relative_paths


def check_package_json_dependency(target, dep_name):
    """Check if a dependency exists in package.json."""
    pkg_path = os.path.join(target, "package.json")
    if not os.path.isfile(pkg_path):
        return False
    try:
        with open(pkg_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        deps = data.get("dependencies", {})
        dev_deps = data.get("devDependencies", {})
        return dep_name in deps or dep_name in dev_deps
    except (json.JSONDecodeError, OSError):
        return False


def check_file_contains(target, rel_path, search_term):
    """Check if a file contains a search term (case-insensitive)."""
    file_path = os.path.join(target, rel_path)
    if not os.path.isfile(file_path):
        return False
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return search_term.lower() in content.lower()
    except (OSError, UnicodeDecodeError):
        return False


def check_spring_dependency(target):
    """Check for Spring framework in Maven or Gradle build files."""
    # Check pom.xml
    pom_path = os.path.join(target, "pom.xml")
    if os.path.isfile(pom_path):
        try:
            with open(pom_path, "r", encoding="utf-8") as f:
                content = f.read()
            if "spring" in content.lower():
                return True, "pom.xml"
        except OSError:
            pass

    # Check build.gradle or build.gradle.kts
    for gradle_file in ("build.gradle", "build.gradle.kts"):
        gradle_path = os.path.join(target, gradle_file)
        if os.path.isfile(gradle_path):
            try:
                with open(gradle_path, "r", encoding="utf-8") as f:
                    content = f.read()
                if "spring" in content.lower():
                    return True, gradle_file
            except OSError:
                pass

    return False, None


def detect_frameworks(target, relative_paths):
    """Detect frameworks based on file markers and dependency analysis."""
    frameworks = []
    markers_found = {}

    path_set = set(relative_paths)
    basenames = {os.path.basename(p): p for p in relative_paths}

    # Next.js detection
    nextjs_markers = []
    for marker in FRAMEWORK_MARKERS["nextjs"]:
        if marker in path_set:
            nextjs_markers.append(marker)
    for marker in FRAMEWORK_MARKERS["nextjs_layout"]:
        if marker in path_set:
            nextjs_markers.append(marker)
    if nextjs_markers:
        frameworks.append("nextjs")
        markers_found["nextjs"] = nextjs_markers

    # Django detection (manage.py + settings.py somewhere)
    has_manage = any(m in path_set or m in basenames for m in FRAMEWORK_MARKERS["django_manage"])
    has_settings = any(os.path.basename(p) == "settings.py" for p in relative_paths)
    if has_manage and has_settings:
        django_markers = []
        if "manage.py" in path_set:
            django_markers.append("manage.py")
        settings_files = [p for p in relative_paths if os.path.basename(p) == "settings.py"]
        django_markers.extend(settings_files)
        frameworks.append("django")
        markers_found["django"] = django_markers

    # Rails detection (Gemfile + config/routes.rb)
    has_gemfile = "Gemfile" in path_set
    has_routes = "config/routes.rb" in path_set
    if has_gemfile and has_routes:
        rails_markers = []
        if has_gemfile:
            rails_markers.append("Gemfile")
        if has_routes:
            rails_markers.append("config/routes.rb")
        frameworks.append("rails")
        markers_found["rails"] = rails_markers

    # Spring detection
    is_spring, spring_file = check_spring_dependency(target)
    if is_spring:
        frameworks.append("spring")
        markers_found["spring"] = [spring_file]

    # Go detection
    if "go.mod" in path_set:
        frameworks.append("go")
        markers_found["go"] = ["go.mod"]

    # Express detection
    if check_package_json_dependency(target, "express"):
        frameworks.append("express")
        markers_found["express"] = ["package.json (express dependency)"]

    # Fastify detection
    if check_package_json_dependency(target, "fastify"):
        frameworks.append("fastify")
        markers_found["fastify"] = ["package.json (fastify dependency)"]

    # Koa detection
    if check_package_json_dependency(target, "koa"):
        frameworks.append("koa")
        markers_found["koa"] = ["package.json (koa dependency)"]

    # FastAPI detection (check before generic Python)
    if "django" not in frameworks:
        fastapi_detected = False
        if "requirements.txt" in path_set:
            fastapi_detected = check_file_contains(target, "requirements.txt", "fastapi")
        if not fastapi_detected and "pyproject.toml" in path_set:
            fastapi_detected = check_file_contains(target, "pyproject.toml", "fastapi")
        if fastapi_detected:
            fastapi_markers = []
            if "requirements.txt" in path_set:
                fastapi_markers.append("requirements.txt (fastapi dependency)")
            if "pyproject.toml" in path_set:
                fastapi_markers.append("pyproject.toml (fastapi dependency)")
            frameworks.append("fastapi")
            markers_found["fastapi"] = fastapi_markers

    # Python detection (generic, if not already Django or FastAPI)
    if "django" not in frameworks and "fastapi" not in frameworks:
        python_markers = []
        if "requirements.txt" in path_set:
            python_markers.append("requirements.txt")
        if "pyproject.toml" in path_set:
            python_markers.append("pyproject.toml")
        if python_markers:
            frameworks.append("python")
            markers_found["python"] = python_markers

    # Rust detection
    if "Cargo.toml" in path_set:
        frameworks.append("rust")
        markers_found["rust"] = ["Cargo.toml"]

    # ASP.NET detection
    csproj_files = [p for p in relative_paths if p.endswith(".csproj")]
    sln_files = [p for p in relative_paths if p.endswith(".sln")]
    if csproj_files or sln_files:
        aspnet_markers = []
        is_aspnet = False
        for csproj in csproj_files:
            if check_file_contains(target, csproj, "Microsoft.AspNetCore") or \
               check_file_contains(target, csproj, "Microsoft.NET.Sdk.Web"):
                aspnet_markers.append(csproj)
                is_aspnet = True
        if is_aspnet:
            frameworks.append("aspnet")
            markers_found["aspnet"] = aspnet_markers
        elif csproj_files or sln_files:
            frameworks.append("dotnet")
            markers_found["dotnet"] = csproj_files[:3] + sln_files[:1]

    # PHP/Laravel detection
    if "composer.json" in path_set:
        frameworks.append("php")
        markers_found["php"] = ["composer.json"]

    return frameworks, markers_found


def detect_languages(relative_paths):
    """Detect programming languages from file extensions."""
    languages = set()
    for path in relative_paths:
        _, ext = os.path.splitext(path)
        if ext in LANGUAGE_EXTENSIONS:
            languages.add(LANGUAGE_EXTENSIONS[ext])
    return sorted(languages)


def detect_package_managers(target, relative_paths):
    """Detect all package managers from lockfiles and manifest files."""
    path_set = set(relative_paths)
    managers = []
    seen = set()

    # Check lockfiles first (higher confidence)
    for lockfile, manager in LOCKFILE_MAP.items():
        if lockfile in path_set and manager not in seen:
            managers.append({"name": manager, "lockfile": lockfile})
            seen.add(manager)

    # Check manifest files for anything not already found via lockfile
    manifest_checks = [
        ("package.json", "npm"),
        ("Gemfile", "bundler"),
        ("requirements.txt", "pip"),
        ("pyproject.toml", "pip"),
        ("composer.json", "composer"),
        ("go.mod", "go"),
        ("Cargo.toml", "cargo"),
    ]
    for manifest, manager in manifest_checks:
        if manifest in path_set and manager not in seen:
            managers.append({"name": manager, "lockfile": None})
            seen.add(manager)

    # Check .csproj files for nuget
    if "nuget" not in seen:
        csproj_files = [p for p in path_set if p.endswith(".csproj")]
        if csproj_files:
            managers.append({"name": "nuget", "lockfile": None})

    return managers


def main():
    parser = argparse.ArgumentParser(
        description="Detect application frameworks, languages, and package managers."
    )
    parser.add_argument(
        "target",
        nargs="?",
        default=".",
        help="Target directory to scan (default: current directory)",
    )
    args = parser.parse_args()

    target = os.path.abspath(args.target)

    if not os.path.isdir(target):
        result = {
            "error": f"Target directory does not exist: {target}",
            "frameworks": [],
            "languages": [],
            "package_managers": [],
            "package_manager": None,
            "markers_found": {},
            "has_lockfile": False,
            "lockfile": None,
        }
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        sys.exit(1)

    try:
        relative_paths = find_files(target, MAX_DEPTH)
        frameworks, markers_found = detect_frameworks(target, relative_paths)
        languages = detect_languages(relative_paths)
        pkg_managers = detect_package_managers(target, relative_paths)

        # Primary package manager (first detected) for backward compat
        primary = pkg_managers[0] if pkg_managers else None

        result = {
            "frameworks": frameworks,
            "languages": languages,
            "package_managers": pkg_managers,
            "package_manager": primary["name"] if primary else None,
            "markers_found": markers_found,
            "has_lockfile": any(m["lockfile"] is not None for m in pkg_managers),
            "lockfile": primary["lockfile"] if primary else None,
        }
    except Exception as e:
        result = {
            "error": str(e),
            "frameworks": [],
            "languages": [],
            "package_managers": [],
            "package_manager": None,
            "markers_found": {},
            "has_lockfile": False,
            "lockfile": None,
        }

    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

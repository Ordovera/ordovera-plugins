import { describe, it, expect } from "vitest";
import { extractNpmDeps, extractPipDeps } from "./osv.js";

describe("extractNpmDeps", () => {
  it("extracts dependencies and devDependencies", () => {
    const pkg = {
      dependencies: { lodash: "^4.17.21", axios: "~1.6.0" },
      devDependencies: { vitest: "^2.0.0" },
    };
    const deps = extractNpmDeps(pkg);

    expect(deps).toHaveLength(3);
    expect(deps.find((d) => d.name === "lodash")).toEqual({
      name: "lodash",
      version: "4.17.21",
      ecosystem: "npm",
    });
    expect(deps.find((d) => d.name === "axios")).toEqual({
      name: "axios",
      version: "1.6.0",
      ecosystem: "npm",
    });
    expect(deps.find((d) => d.name === "vitest")).toEqual({
      name: "vitest",
      version: "2.0.0",
      ecosystem: "npm",
    });
  });

  it("handles missing dependency sections", () => {
    expect(extractNpmDeps({})).toEqual([]);
    expect(extractNpmDeps({ dependencies: {} })).toEqual([]);
  });

  it("strips semver range prefixes", () => {
    const pkg = {
      dependencies: {
        a: ">=1.0.0",
        b: "<2.0.0",
        c: "1.0.0",
        d: "^0.5.0",
      },
    };
    const deps = extractNpmDeps(pkg);
    expect(deps.find((d) => d.name === "a")?.version).toBe("1.0.0");
    expect(deps.find((d) => d.name === "b")?.version).toBe("2.0.0");
    expect(deps.find((d) => d.name === "c")?.version).toBe("1.0.0");
    expect(deps.find((d) => d.name === "d")?.version).toBe("0.5.0");
  });
});

describe("extractPipDeps", () => {
  it("extracts packages with versions", () => {
    const content = "flask==2.0.0\nrequests>=2.28.0\nsqlalchemy";
    const deps = extractPipDeps(content);

    expect(deps).toHaveLength(3);
    expect(deps[0]).toEqual({ name: "flask", version: "2.0.0", ecosystem: "PyPI" });
    expect(deps[1]).toEqual({ name: "requests", version: "2.28.0", ecosystem: "PyPI" });
    expect(deps[2]).toEqual({ name: "sqlalchemy", version: "", ecosystem: "PyPI" });
  });

  it("skips comments and blank lines", () => {
    const content = "# this is a comment\n\nflask==2.0.0\n  # another comment\n";
    const deps = extractPipDeps(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe("flask");
  });

  it("skips flags", () => {
    const content = "-r other-requirements.txt\n--index-url https://example.com\nflask==2.0.0";
    const deps = extractPipDeps(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe("flask");
  });

  it("handles complex version specifiers", () => {
    const content = "django>=3.2,<4.0\nnumpy==1.24.0";
    const deps = extractPipDeps(content);
    expect(deps[0]).toEqual({ name: "django", version: "3.2", ecosystem: "PyPI" });
    expect(deps[1]).toEqual({ name: "numpy", version: "1.24.0", ecosystem: "PyPI" });
  });

  it("returns empty for empty input", () => {
    expect(extractPipDeps("")).toEqual([]);
    expect(extractPipDeps("\n\n")).toEqual([]);
  });
});

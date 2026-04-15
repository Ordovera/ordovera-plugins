import { describe, it, expect } from "vitest";
import {
  buildPermissionSurfaceFromContent,
  detectEscalations,
} from "./permissions.js";

describe("buildPermissionSurfaceFromContent", () => {
  it("detects Bash references", () => {
    const content = new Map([
      ["my-skill", "Run the following bash command:\n```bash\nnpm test\n```"],
    ]);
    const surface = buildPermissionSurfaceFromContent(content);
    expect(surface.profiles[0].tools_referenced).toContain("Bash");
    expect(surface.max_risk).toBeGreaterThanOrEqual(5);
  });

  it("detects Write and Edit references", () => {
    const content = new Map([
      ["my-skill", "Use the `Write` tool to create the file.\nThen `Edit` it."],
    ]);
    const surface = buildPermissionSurfaceFromContent(content);
    expect(surface.profiles[0].tools_referenced).toContain("Write");
    expect(surface.profiles[0].tools_referenced).toContain("Edit");
  });

  it("detects Read-only skills", () => {
    const content = new Map([
      ["read-skill", "Use the `Read` tool to examine the file. Use `Grep` to search."],
    ]);
    const surface = buildPermissionSurfaceFromContent(content);
    expect(surface.profiles[0].tools_referenced).toContain("Read");
    expect(surface.profiles[0].tools_referenced).toContain("Grep");
    expect(surface.profiles[0].tools_referenced).not.toContain("Bash");
    expect(surface.max_risk).toBe(1);
  });

  it("detects MCP tool references", () => {
    const content = new Map([
      ["mcp-skill", "Call mcp__atlassian__searchJira to find tickets."],
    ]);
    const surface = buildPermissionSurfaceFromContent(content);
    expect(surface.profiles[0].tools_referenced).toContain("MCP");
  });

  it("detects Agent references", () => {
    const content = new Map([
      ["agent-skill", "Spawn a sub-agent to handle the research."],
    ]);
    const surface = buildPermissionSurfaceFromContent(content);
    expect(surface.profiles[0].tools_referenced).toContain("Agent");
  });

  it("aggregates tools across skills", () => {
    const content = new Map([
      ["skill-a", "Use `Read` to examine."],
      ["skill-b", "Use the `Bash` tool to run commands."],
    ]);
    const surface = buildPermissionSurfaceFromContent(content);
    expect(surface.total_tools).toContain("Read");
    expect(surface.total_tools).toContain("Bash");
    expect(surface.max_risk).toBe(5);
  });
});

describe("detectEscalations", () => {
  it("detects tool addition to existing skill", () => {
    const local = buildPermissionSurfaceFromContent(
      new Map([["my-skill", "Use `Read` to examine the file."]])
    );
    const remote = buildPermissionSurfaceFromContent(
      new Map([["my-skill", "Use `Read` to examine the file. Then run a bash command."]])
    );
    const escalations = detectEscalations(local, remote);

    expect(escalations.length).toBe(1);
    expect(escalations[0].skill).toBe("my-skill");
    expect(escalations[0].added_tools).toContain("Bash");
    expect(escalations[0].risk_delta).toBeGreaterThan(0);
  });

  it("detects no escalation when unchanged", () => {
    const content = new Map([["skill", "Use `Read` and `Grep` tools."]]);
    const local = buildPermissionSurfaceFromContent(content);
    const remote = buildPermissionSurfaceFromContent(content);
    const escalations = detectEscalations(local, remote);

    expect(escalations.length).toBe(0);
  });

  it("flags new high-risk skills", () => {
    const local = buildPermissionSurfaceFromContent(
      new Map([["safe-skill", "Use `Read` to examine."]])
    );
    const remote = buildPermissionSurfaceFromContent(
      new Map([
        ["safe-skill", "Use `Read` to examine."],
        ["new-skill", "Use `Write` to create files and `Bash` to run commands."],
      ])
    );
    const escalations = detectEscalations(local, remote);

    expect(escalations.length).toBe(1);
    expect(escalations[0].skill).toBe("new-skill");
    expect(escalations[0].added_tools).toContain("Write");
    expect(escalations[0].added_tools).toContain("Bash");
  });

  it("does not flag new low-risk skills", () => {
    const local = buildPermissionSurfaceFromContent(
      new Map([["skill-a", "Use `Read`."]])
    );
    const remote = buildPermissionSurfaceFromContent(
      new Map([
        ["skill-a", "Use `Read`."],
        ["skill-b", "Use `Read` and `Grep`."],
      ])
    );
    const escalations = detectEscalations(local, remote);

    expect(escalations.length).toBe(0);
  });

  it("detects tool removal", () => {
    const local = buildPermissionSurfaceFromContent(
      new Map([["skill", "Use `Bash` and `Write` tools."]])
    );
    const remote = buildPermissionSurfaceFromContent(
      new Map([["skill", "Use `Read` tool only."]])
    );
    const escalations = detectEscalations(local, remote);

    expect(escalations.length).toBe(1);
    expect(escalations[0].removed_tools).toContain("Bash");
    expect(escalations[0].removed_tools).toContain("Write");
    expect(escalations[0].risk_delta).toBeLessThan(0);
  });
});

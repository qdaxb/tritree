import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Skill } from "@/lib/domain";
import {
  createSkillRuntimeTools,
  defaultSkillExecutionMode,
  listInstalledSkillDocuments,
  loadInstalledSkillDocument,
  runInstalledSkillCommand
} from "./skill-runtime";

const sampleSkill: Skill = {
  id: "sample-platform-skills",
  title: "sample-platform-skills",
  category: "平台",
  description: "示例平台技能集合。",
  prompt: "当用户要求操作示例平台时触发。",
  appliesTo: "both",
  isSystem: false,
  defaultEnabled: false,
  isArchived: false,
  createdAt: "2026-05-07T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z"
};

describe("defaultSkillExecutionMode", () => {
  it("uses auto mode by default and accepts explicit Tritree skill execution modes", () => {
    expect(defaultSkillExecutionMode({})).toBe("auto");
    expect(defaultSkillExecutionMode({ TRITREE_SKILL_EXECUTION_MODE: "trusted-host" })).toBe("trusted-host");
    expect(defaultSkillExecutionMode({ TRITREE_SKILL_EXECUTION_MODE: "macos-seatbelt" })).toBe("macos-seatbelt");
  });

  it("rejects unsupported execution modes", () => {
    expect(() => defaultSkillExecutionMode({ TRITREE_SKILL_EXECUTION_MODE: "docker" })).toThrow(
      "Unsupported TRITREE_SKILL_EXECUTION_MODE"
    );
  });
});

describe("runInstalledSkillCommand", () => {
  it("runs skill CLI commands from the installed skill directory", async () => {
    const installRoot = mkdtempSync(path.join(tmpdir(), "tritree-skill-runtime-"));
    const skillDir = path.join(installRoot, "sample-platform-skills");
    mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "name: sample-platform-skills");
    writeFileSync(path.join(skillDir, "scripts", "cli.py"), "");
    const runCommand = vi.fn(async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ feeds: [{ note_card: { title: "sample result" } }] })
    }));

    const result = await runInstalledSkillCommand(
      {
        args: ["--keyword", "sample topic", "--sort-by", "top"],
        executionMode: "trusted-host",
        installRoot,
        runCommand,
        skillName: "sample-platform-skills",
        subcommand: "search-feeds"
      }
    );

    expect(runCommand).toHaveBeenCalledWith(
      "uv",
      ["run", "python", "scripts/cli.py", "search-feeds", "--keyword", "sample topic", "--sort-by", "top"],
      expect.objectContaining({
        cwd: skillDir,
        timeoutMs: 45000
      })
    );
    expect(result.ok).toBe(true);
    expect(result.json).toEqual({ feeds: [{ note_card: { title: "sample result" } }] });
  });

  it("wraps commands in a generated macOS Seatbelt profile", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "tritree-skill-sandbox-"));
    const installRoot = path.join(rootDir, "skills");
    const runRoot = path.join(rootDir, "runs");
    const stateRoot = path.join(rootDir, "state");
    const skillDir = path.join(installRoot, "sample-platform-skills");
    mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "name: sample-platform-skills");
    writeFileSync(path.join(skillDir, "scripts", "cli.py"), "");
    const runCommand = vi.fn(async () => ({ exitCode: 0, stderr: "", stdout: "{}" }));

    await runInstalledSkillCommand({
      args: ["--keyword", "sample topic"],
      executionMode: "macos-seatbelt",
      installRoot,
      runRoot,
      runCommand,
      skillName: "sample-platform-skills",
      stateRoot,
      subcommand: "search-feeds"
    });

    expect(runCommand).toHaveBeenCalledWith(
      "sandbox-exec",
      ["-f", expect.stringMatching(/sample-platform-skills-[a-f0-9-]+\.sb$/), "uv", "run", "python", "scripts/cli.py", "search-feeds", "--keyword", "sample topic"],
      expect.objectContaining({
        cwd: skillDir,
        env: expect.objectContaining({
          HOME: path.join(stateRoot, "sample-platform-skills", "home"),
          TMPDIR: path.join(stateRoot, "sample-platform-skills", "tmp"),
          UV_CACHE_DIR: path.join(stateRoot, "sample-platform-skills", "uv-cache"),
          UV_PROJECT_ENVIRONMENT: path.join(stateRoot, "sample-platform-skills", "venv"),
          XDG_CACHE_HOME: path.join(stateRoot, "sample-platform-skills", "cache"),
          XDG_CONFIG_HOME: path.join(stateRoot, "sample-platform-skills", "config")
        })
      })
    );
    const calls = runCommand.mock.calls as unknown as Array<[string, string[], unknown]>;
    const profilePath = calls[0]?.[1][1];
    if (!profilePath) throw new Error("Expected sandbox profile path.");
    const profile = readFileSync(profilePath, "utf8");
    expect(profile).toContain("(deny default)");
    expect(profile).toContain("(allow file-read*)");
    expect(profile).toContain('(literal "/dev/null")');
    expect(profile).toContain(`(subpath "${path.join(stateRoot, "sample-platform-skills")}")`);
    expect(profile).toContain(`(subpath "${runRoot}")`);
    expect(profile).toContain("(allow network*)");
  });

  it("keeps the process error message when a failed command has no stdout or stderr", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "tritree-skill-empty-failure-"));
    const fakeBin = path.join(rootDir, "bin");
    const installRoot = path.join(rootDir, "skills");
    const skillDir = path.join(installRoot, "sample-platform-skills");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "name: sample-platform-skills");
    writeFileSync(path.join(skillDir, "scripts", "cli.py"), "");
    writeFileSync(path.join(fakeBin, "uv"), "#!/bin/sh\nexit 1\n");
    chmodSync(path.join(fakeBin, "uv"), 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${path.delimiter}${previousPath ?? ""}`;

    try {
      const result = await runInstalledSkillCommand({
        args: [],
        executionMode: "trusted-host",
        installRoot,
        skillName: "sample-platform-skills",
        subcommand: "check-login"
      });

      expect(result.exitCode).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("Command failed");
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("allows executable skill login commands through argv-safe execution", async () => {
    const installRoot = mkdtempSync(path.join(tmpdir(), "tritree-skill-login-"));
    const skillDir = path.join(installRoot, "sample-platform-skills");
    mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "name: sample-platform-skills");
    writeFileSync(path.join(skillDir, "scripts", "cli.py"), "");
    const runCommand = vi.fn(async () => ({ exitCode: 0, stderr: "", stdout: "{}" }));

    await runInstalledSkillCommand({
      args: ["--account", "default"],
      executionMode: "trusted-host",
      installRoot,
      runCommand,
      skillName: "sample-platform-skills",
      subcommand: "login"
    });

    await runInstalledSkillCommand({
      args: [],
      executionMode: "trusted-host",
      installRoot,
      runCommand,
      skillName: "sample-platform-skills",
      subcommand: "check-login"
    });

    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      "uv",
      ["run", "python", "scripts/cli.py", "login", "--account", "default"],
      expect.objectContaining({ cwd: skillDir })
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      "uv",
      ["run", "python", "scripts/cli.py", "check-login"],
      expect.objectContaining({ cwd: skillDir })
    );
  });
});

describe("createSkillRuntimeTools", () => {
  it("exposes a load_skill tool for enabled skills whose prompts are loaded on demand", async () => {
    const runtime = await createSkillRuntimeTools([
      {
        ...sampleSkill,
        id: "system-planner",
        title: "策划",
        description: "负责方向判断。",
        prompt: "策划子技能完整正文。",
        defaultEnabled: true,
        defaultLoaded: false,
        parentSkillId: "system-creator"
      }
    ]);

    expect(runtime.toolSummaries.join("\n")).toContain("load_skill");
    expect(Object.keys(runtime.tools)).toEqual(["load_skill"]);
    await expect((runtime.tools.load_skill as { execute: (input: { skillId: string }) => Promise<unknown> }).execute({
      skillId: "system-planner"
    })).resolves.toEqual(
      expect.objectContaining({
        content: "策划子技能完整正文。",
        id: "system-planner",
        ok: true,
        title: "策划"
      })
    );
  });

  it("exposes an agent tool for installed enabled skills", async () => {
    const installRoot = mkdtempSync(path.join(tmpdir(), "tritree-skill-tools-"));
    const skillDir = path.join(installRoot, "sample-platform-skills");
    mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    mkdirSync(path.join(skillDir, "skills", "sample-research"), { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: sample-platform-skills\ndescription: 示例平台技能集合。\n---\n\n# 示例平台自动化\n\n按需调用子 skill。"
    );
    writeFileSync(
      path.join(skillDir, "skills", "sample-research", "SKILL.md"),
      "---\nname: sample-research\ndescription: 搜索示例平台内容。\n---\n\n# 示例平台搜索\n\n使用 search-feeds 做外部参考。"
    );
    writeFileSync(path.join(skillDir, "scripts", "cli.py"), "");

    const runtime = await createSkillRuntimeTools([sampleSkill], { installRoot });

    expect(runtime.toolSummaries.join("\n")).toContain("sample-platform-skills");
    expect(runtime.toolSummaries.join("\n")).toContain("load_skill_document");
    expect(runtime.toolSummaries.join("\n")).toContain("optional filters or sort parameters fail");
    expect(Object.keys(runtime.tools)).toEqual(["load_skill_document", "run_skill_command"]);
    expect(runtime.availableSkillSummaries.join("\n")).toContain("sample-research");
    expect(runtime.enabledSkills[0].prompt).toContain(`This Skill is installed at: ${skillDir}`);
    expect(runtime.enabledSkills[0].prompt).toContain("run_skill_command");
    expect(runtime.enabledSkills[0].prompt).toContain("# Loadable Skill Documents");
    expect(runtime.enabledSkills[0].prompt).toContain("skills/sample-research/SKILL.md");
    expect(runtime.enabledSkills[0].prompt).not.toContain("使用 search-feeds 做外部参考。");
  });
});

describe("progressive skill documents", () => {
  it("lists and loads installed root and child SKILL.md files by stable document names", () => {
    const installRoot = mkdtempSync(path.join(tmpdir(), "tritree-skill-docs-"));
    const skillDir = path.join(installRoot, "sample-platform-skills");
    mkdirSync(path.join(skillDir, "skills", "sample-research"), { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: sample-platform-skills\ndescription: 示例平台技能集合。\n---\n\n# Root\n\n按需加载子 skill。"
    );
    writeFileSync(
      path.join(skillDir, "skills", "sample-research", "SKILL.md"),
      "---\nname: sample-research\ndescription: 搜索示例平台内容。\n---\n\n# Explore\n\n搜索前确认关键词。"
    );

    expect(listInstalledSkillDocuments(installRoot, "sample-platform-skills")).toEqual([
      expect.objectContaining({
        description: "示例平台技能集合。",
        name: "sample-platform-skills",
        path: "SKILL.md"
      }),
      expect.objectContaining({
        description: "搜索示例平台内容。",
        name: "sample-research",
        path: "skills/sample-research/SKILL.md"
      })
    ]);

    expect(loadInstalledSkillDocument({ document: "sample-research", installRoot, skillName: "sample-platform-skills" })).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("搜索前确认关键词。"),
        path: "skills/sample-research/SKILL.md",
        skillName: "sample-platform-skills"
      })
    );
    expect(loadInstalledSkillDocument({ document: "SKILL.md", installRoot, skillName: "sample-platform-skills" }).content)
      .toContain("按需加载子 skill。");
  });

  it("rejects attempts to load files outside the installed skill document set", () => {
    const installRoot = mkdtempSync(path.join(tmpdir(), "tritree-skill-docs-escape-"));
    const skillDir = path.join(installRoot, "sample-platform-skills");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "name: sample-platform-skills");

    expect(() =>
      loadInstalledSkillDocument({ document: "../secrets.md", installRoot, skillName: "sample-platform-skills" })
    ).toThrow("Skill document must be a root SKILL.md or a child skills/<name>/SKILL.md.");
  });
});

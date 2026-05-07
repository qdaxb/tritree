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

const xhsSkill: Skill = {
  id: "xiaohongshu-skills",
  title: "xiaohongshu-skills",
  category: "平台",
  description: "小红书自动化技能集合。",
  prompt: "当用户要求操作小红书时触发。",
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
    const skillDir = path.join(installRoot, "xiaohongshu-skills");
    mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "name: xiaohongshu-skills");
    writeFileSync(path.join(skillDir, "scripts", "cli.py"), "");
    const runCommand = vi.fn(async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ feeds: [{ note_card: { title: "青岛三天两晚攻略" } }] })
    }));

    const result = await runInstalledSkillCommand(
      {
        args: ["--keyword", "青岛旅游攻略", "--sort-by", "最多点赞"],
        executionMode: "trusted-host",
        installRoot,
        runCommand,
        skillName: "xiaohongshu-skills",
        subcommand: "search-feeds"
      }
    );

    expect(runCommand).toHaveBeenCalledWith(
      "uv",
      ["run", "python", "scripts/cli.py", "search-feeds", "--keyword", "青岛旅游攻略", "--sort-by", "最多点赞"],
      expect.objectContaining({
        cwd: skillDir,
        timeoutMs: 45000
      })
    );
    expect(result.ok).toBe(true);
    expect(result.json).toEqual({ feeds: [{ note_card: { title: "青岛三天两晚攻略" } }] });
  });

  it("wraps commands in a generated macOS Seatbelt profile", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "tritree-skill-sandbox-"));
    const installRoot = path.join(rootDir, "skills");
    const runRoot = path.join(rootDir, "runs");
    const stateRoot = path.join(rootDir, "state");
    const skillDir = path.join(installRoot, "xiaohongshu-skills");
    mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "name: xiaohongshu-skills");
    writeFileSync(path.join(skillDir, "scripts", "cli.py"), "");
    const runCommand = vi.fn(async () => ({ exitCode: 0, stderr: "", stdout: "{}" }));

    await runInstalledSkillCommand({
      args: ["--keyword", "青岛旅游攻略"],
      executionMode: "macos-seatbelt",
      installRoot,
      runRoot,
      runCommand,
      skillName: "xiaohongshu-skills",
      stateRoot,
      subcommand: "search-feeds"
    });

    expect(runCommand).toHaveBeenCalledWith(
      "sandbox-exec",
      ["-f", expect.stringMatching(/xiaohongshu-skills-[a-f0-9-]+\.sb$/), "uv", "run", "python", "scripts/cli.py", "search-feeds", "--keyword", "青岛旅游攻略"],
      expect.objectContaining({
        cwd: skillDir,
        env: expect.objectContaining({
          HOME: path.join(stateRoot, "xiaohongshu-skills", "home"),
          TMPDIR: path.join(stateRoot, "xiaohongshu-skills", "tmp"),
          UV_CACHE_DIR: path.join(stateRoot, "xiaohongshu-skills", "uv-cache"),
          UV_PROJECT_ENVIRONMENT: path.join(stateRoot, "xiaohongshu-skills", "venv"),
          XDG_CACHE_HOME: path.join(stateRoot, "xiaohongshu-skills", "cache"),
          XDG_CONFIG_HOME: path.join(stateRoot, "xiaohongshu-skills", "config")
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
    expect(profile).toContain(`(subpath "${path.join(stateRoot, "xiaohongshu-skills")}")`);
    expect(profile).toContain(`(subpath "${runRoot}")`);
    expect(profile).toContain("(allow network*)");
  });

  it("keeps the process error message when a failed command has no stdout or stderr", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "tritree-skill-empty-failure-"));
    const fakeBin = path.join(rootDir, "bin");
    const installRoot = path.join(rootDir, "skills");
    const skillDir = path.join(installRoot, "xiaohongshu-skills");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "name: xiaohongshu-skills");
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
        skillName: "xiaohongshu-skills",
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
    const skillDir = path.join(installRoot, "xiaohongshu-skills");
    mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "name: xiaohongshu-skills");
    writeFileSync(path.join(skillDir, "scripts", "cli.py"), "");
    const runCommand = vi.fn(async () => ({ exitCode: 0, stderr: "", stdout: "{}" }));

    await runInstalledSkillCommand({
      args: ["--account", "default"],
      executionMode: "trusted-host",
      installRoot,
      runCommand,
      skillName: "xiaohongshu-skills",
      subcommand: "login"
    });

    await runInstalledSkillCommand({
      args: [],
      executionMode: "trusted-host",
      installRoot,
      runCommand,
      skillName: "xiaohongshu-skills",
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
  it("exposes an agent tool for installed enabled skills", async () => {
    const installRoot = mkdtempSync(path.join(tmpdir(), "tritree-skill-tools-"));
    const skillDir = path.join(installRoot, "xiaohongshu-skills");
    mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
    mkdirSync(path.join(skillDir, "skills", "xhs-explore"), { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: xiaohongshu-skills\ndescription: 小红书自动化技能集合。\n---\n\n# 小红书自动化\n\n按需调用子 skill。"
    );
    writeFileSync(
      path.join(skillDir, "skills", "xhs-explore", "SKILL.md"),
      "---\nname: xhs-explore\ndescription: 搜索小红书内容。\n---\n\n# 小红书搜索\n\n使用 search-feeds 做外部参考。"
    );
    writeFileSync(path.join(skillDir, "scripts", "cli.py"), "");

    const runtime = await createSkillRuntimeTools([xhsSkill], { installRoot });

    expect(runtime.toolSummaries.join("\n")).toContain("xiaohongshu-skills");
    expect(runtime.toolSummaries.join("\n")).toContain("load_skill_document");
    expect(runtime.toolSummaries.join("\n")).toContain("可选参数失败");
    expect(Object.keys(runtime.tools)).toEqual(["load_skill_document", "run_skill_command"]);
    expect(runtime.availableSkillSummaries.join("\n")).toContain("xhs-explore");
    expect(runtime.enabledSkills[0].prompt).toContain(`此 Skill 已安装在：${skillDir}`);
    expect(runtime.enabledSkills[0].prompt).toContain("run_skill_command");
    expect(runtime.enabledSkills[0].prompt).toContain("# 可渐进加载的 Skill 文档");
    expect(runtime.enabledSkills[0].prompt).toContain("skills/xhs-explore/SKILL.md");
    expect(runtime.enabledSkills[0].prompt).not.toContain("使用 search-feeds 做外部参考。");
  });
});

describe("progressive skill documents", () => {
  it("lists and loads installed root and child SKILL.md files by stable document names", () => {
    const installRoot = mkdtempSync(path.join(tmpdir(), "tritree-skill-docs-"));
    const skillDir = path.join(installRoot, "xiaohongshu-skills");
    mkdirSync(path.join(skillDir, "skills", "xhs-explore"), { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: xiaohongshu-skills\ndescription: 小红书自动化技能集合。\n---\n\n# Root\n\n按需加载子 skill。"
    );
    writeFileSync(
      path.join(skillDir, "skills", "xhs-explore", "SKILL.md"),
      "---\nname: xhs-explore\ndescription: 搜索小红书内容。\n---\n\n# Explore\n\n搜索前确认关键词。"
    );

    expect(listInstalledSkillDocuments(installRoot, "xiaohongshu-skills")).toEqual([
      expect.objectContaining({
        description: "小红书自动化技能集合。",
        name: "xiaohongshu-skills",
        path: "SKILL.md"
      }),
      expect.objectContaining({
        description: "搜索小红书内容。",
        name: "xhs-explore",
        path: "skills/xhs-explore/SKILL.md"
      })
    ]);

    expect(loadInstalledSkillDocument({ document: "xhs-explore", installRoot, skillName: "xiaohongshu-skills" })).toEqual(
      expect.objectContaining({
        content: expect.stringContaining("搜索前确认关键词。"),
        path: "skills/xhs-explore/SKILL.md",
        skillName: "xiaohongshu-skills"
      })
    );
    expect(loadInstalledSkillDocument({ document: "SKILL.md", installRoot, skillName: "xiaohongshu-skills" }).content).toContain(
      "按需加载子 skill。"
    );
  });

  it("rejects attempts to load files outside the installed skill document set", () => {
    const installRoot = mkdtempSync(path.join(tmpdir(), "tritree-skill-docs-escape-"));
    const skillDir = path.join(installRoot, "xiaohongshu-skills");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "name: xiaohongshu-skills");

    expect(() =>
      loadInstalledSkillDocument({ document: "../secrets.md", installRoot, skillName: "xiaohongshu-skills" })
    ).toThrow("Skill document must be a root SKILL.md or a child skills/<name>/SKILL.md.");
  });
});

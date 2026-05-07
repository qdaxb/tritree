import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  defaultSkillInstallRoot,
  installSkillFromGitHub,
  parseSkillMarkdown,
  stripSkillRuntimeMetadata
} from "./skill-installer";

const rootSkillMarkdown = `---
name: xiaohongshu-skills
description: |
  小红书自动化技能集合。
  支持认证登录、内容发布、搜索发现。
version: 1.0.0
---

# 小红书自动化 Skills

当用户要求操作小红书时触发。
`;

describe("parseSkillMarkdown", () => {
  it("reads Claude/Codex style SKILL.md front matter", () => {
    const parsed = parseSkillMarkdown(rootSkillMarkdown, "SKILL.md");

    expect(parsed.name).toBe("xiaohongshu-skills");
    expect(parsed.description).toBe("小红书自动化技能集合。 支持认证登录、内容发布、搜索发现。");
    expect(parsed.body).toContain("小红书自动化 Skills");
  });

  it("falls back to parent directory name when front matter is absent", () => {
    const parsed = parseSkillMarkdown("# 自然短句\n\n让表达更口语。", "skills/natural-short/SKILL.md");

    expect(parsed.name).toBe("natural-short");
    expect(parsed.description).toBe("让表达更口语。");
  });
});

describe("installSkillFromGitHub", () => {
  it("uses ~/.tritree/skills as the default install root", () => {
    expect(defaultSkillInstallRoot()).toBe(path.join(homedir(), ".tritree", "skills"));
  });

  it("installs a repository into the install root by skill name and imports one root skill", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "tritree-skill-install-"));
    const installRoot = path.join(rootDir, ".tritree", "skills");
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      const targetDir = args.at(-1);
      if (!targetDir) throw new Error("missing clone target");
      mkdirSync(path.join(targetDir, "skills", "xhs-publish"), { recursive: true });
      writeFileSync(path.join(targetDir, "SKILL.md"), rootSkillMarkdown);
      writeFileSync(
        path.join(targetDir, "skills", "xhs-publish", "SKILL.md"),
        "---\nname: xhs-publish\ndescription: 发布小红书内容。\n---\n\n# 小红书发布\n\n发布前确认。"
      );
      writeFileSync(path.join(targetDir, "pyproject.toml"), "[project]\nname='xiaohongshu-skills'\nversion='1.0.0'\n");
    });

    const imported = await installSkillFromGitHub("https://github.com/autoclaw-cc/xiaohongshu-skills", {
      installRoot,
      runCommand
    });

    expect(imported.skills).toHaveLength(1);
    expect(imported.skill.id).toBe("xiaohongshu-skills");
    expect(imported.skill.title).toBe("xiaohongshu-skills");
    expect(imported.skill.description).toBe("小红书自动化技能集合。 支持认证登录、内容发布、搜索发现。");
    expect(imported.skill.prompt).toContain("# 小红书自动化 Skills");
    expect(imported.skill.prompt).toContain("# 可渐进加载的 Skill 文档");
    expect(imported.skill.prompt).toContain("- xhs-publish（skills/xhs-publish/SKILL.md）：发布小红书内容。");
    expect(imported.skill.prompt).not.toContain("此 Skill 已安装在");
    expect(imported.skill.prompt).not.toContain("来源：");
    expect(imported.skill.prompt).not.toContain("run_skill_command");
    expect(imported.skill.prompt).not.toContain("发布前确认。");
    expect(imported.installPath).toBe(path.join(installRoot, "xiaohongshu-skills"));
    expect(imported.installPaths).toEqual([path.join(installRoot, "xiaohongshu-skills")]);
    expect(imported.checkoutPath).toBe(path.join(installRoot, ".repos", "xiaohongshu-skills"));
    expect(readFileSync(path.join(imported.installPath, "SKILL.md"), "utf8")).toContain("xiaohongshu-skills");
    expect(runCommand).toHaveBeenCalledWith("git", [
      "clone",
      "--depth",
      "1",
      "https://github.com/autoclaw-cc/xiaohongshu-skills",
      path.join(installRoot, ".repos", "xiaohongshu-skills")
    ]);
  });

  it("imports multiple top-level skills from one repository", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "tritree-multi-skill-install-"));
    const installRoot = path.join(rootDir, ".tritree", "skills");
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      const targetDir = args.at(-1);
      if (!targetDir) throw new Error("missing clone target");
      mkdirSync(path.join(targetDir, "travel-writer", "skills", "research"), { recursive: true });
      mkdirSync(path.join(targetDir, "title-polish"), { recursive: true });
      writeFileSync(
        path.join(targetDir, "travel-writer", "SKILL.md"),
        "---\nname: travel-writer\ndescription: 旅行攻略写作。\n---\n\n# Travel Writer\n\n写真实可用的攻略。"
      );
      writeFileSync(
        path.join(targetDir, "travel-writer", "skills", "research", "SKILL.md"),
        "---\nname: research\ndescription: 查询目的地参考。\n---\n\n# Research\n\n先搜索资料。"
      );
      writeFileSync(
        path.join(targetDir, "title-polish", "SKILL.md"),
        "---\nname: title-polish\ndescription: 标题润色。\n---\n\n# Title Polish\n\n标题自然一点。"
      );
    });

    const imported = await installSkillFromGitHub("https://github.com/example/content-skills", {
      installRoot,
      runCommand
    });

    expect(imported.skills.map((skill) => skill.id)).toEqual(["title-polish", "travel-writer"]);
    expect(imported.installPaths).toEqual([
      path.join(installRoot, "title-polish"),
      path.join(installRoot, "travel-writer")
    ]);
    expect(readFileSync(path.join(installRoot, "travel-writer", "SKILL.md"), "utf8")).toContain("Travel Writer");
    expect(imported.skills.find((skill) => skill.id === "travel-writer")?.prompt).toContain("skills/research/SKILL.md");
    expect(imported.skills.find((skill) => skill.id === "travel-writer")?.prompt).not.toContain("先搜索资料。");
    expect(runCommand).toHaveBeenCalledWith("git", [
      "clone",
      "--depth",
      "1",
      "https://github.com/example/content-skills",
      path.join(installRoot, ".repos", "content-skills")
    ]);
  });

  it("strips previously stored runtime metadata from imported skill prompts", () => {
    expect(
      stripSkillRuntimeMetadata(
        [
          "此 Skill 已安装在：/tmp/repo/.tritree/skills/example",
          "来源：https://github.com/example/skill",
          "Tritree 是当前 agent runtime。生成选项或草稿时，请按以下 SKILL.md 指令判断是否需要调用可用工具。",
          "",
          "# Root Skill",
          "# Example",
          "",
          "真实 skill 指令。"
        ].join("\n")
      )
    ).toBe(["# Root Skill", "# Example", "", "真实 skill 指令。"].join("\n"));
  });
});

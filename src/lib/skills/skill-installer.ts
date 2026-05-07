import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SkillCategory, SkillUpsert } from "@/lib/domain";

const execFileAsync = promisify(execFile);

export type InstalledSkillImport = SkillUpsert & {
  id: string;
};

export type InstalledSkill = {
  installPath: string;
  skill: InstalledSkillImport;
};

export type InstalledSkills = {
  checkoutPath: string;
  installPath: string;
  installPaths: string[];
  installedSkills: InstalledSkill[];
  skill: InstalledSkillImport;
  skills: InstalledSkillImport[];
};

type ParsedSkillMarkdown = ReturnType<typeof parseSkillMarkdown>;

type CommandRunner = (command: string, args: string[]) => Promise<unknown>;

export class UnsupportedSkillSourceError extends Error {
  constructor(sourceUrl: string) {
    super(`Unsupported skill source: ${sourceUrl}`);
  }
}

export function defaultSkillInstallRoot() {
  return path.join(homedir(), ".tritree", "skills");
}

export async function installSkillFromGitHub(
  sourceUrl: string,
  {
    installRoot = defaultSkillInstallRoot(),
    runCommand = defaultRunCommand
  }: {
    installRoot?: string;
    runCommand?: CommandRunner;
  } = {}
): Promise<InstalledSkills> {
  const source = parseGitHubRepositoryUrl(sourceUrl);
  mkdirSync(installRoot, { recursive: true });
  const checkoutPath = path.join(installRoot, ".repos", source.repo);

  if (existsSync(checkoutPath)) {
    await runCommand("git", ["-C", checkoutPath, "pull", "--ff-only"]);
  } else {
    mkdirSync(path.dirname(checkoutPath), { recursive: true });
    await runCommand("git", ["clone", "--depth", "1", sourceUrl, checkoutPath]);
  }

  const installableSkillSources = findInstallableSkillSources(checkoutPath, source.repo);
  if (installableSkillSources.length === 0) {
    throw new Error("Installed repository does not contain a root SKILL.md or top-level skill directories.");
  }

  const installedSkills = installableSkillSources.map((skillSource) => {
    const installPath = path.join(installRoot, skillSource.installName);
    syncSkillDirectory(skillSource.sourcePath, installPath);
    return readInstalledSkillFromDirectory(installPath, { sourceUrl });
  });

  return {
    checkoutPath,
    installPath: installedSkills[0].installPath,
    installPaths: installedSkills.map((installed) => installed.installPath),
    installedSkills,
    skill: installedSkills[0].skill,
    skills: installedSkills.map((installed) => installed.skill)
  };
}

export function discoverInstalledSkills({
  installRoot = defaultSkillInstallRoot()
}: {
  installRoot?: string;
} = {}): InstalledSkill[] {
  if (!existsSync(installRoot)) return [];

  return readdirSync(installRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        const installPath = path.join(installRoot, entry.name);
        if (!existsSync(path.join(installPath, "SKILL.md"))) return [];
        return [readInstalledSkillFromDirectory(installPath)];
      } catch {
        return [];
      }
    })
    .sort((first, second) => first.skill.title.localeCompare(second.skill.title));
}

function findInstallableSkillSources(checkoutPath: string, repoName: string) {
  const sources: Array<{ installName: string; sourcePath: string }> = [];

  if (existsSync(path.join(checkoutPath, "SKILL.md")) && isSafeSkillDirectoryName(repoName)) {
    sources.push({ installName: repoName, sourcePath: checkoutPath });
  }

  sources.push(
    ...readdirSync(checkoutPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => entry.name !== "skills" && !entry.name.startsWith("."))
      .filter((entry) => isSafeSkillDirectoryName(entry.name))
      .map((entry) => ({ installName: entry.name, sourcePath: path.join(checkoutPath, entry.name) }))
      .filter((entry) => existsSync(path.join(entry.sourcePath, "SKILL.md")))
      .sort((first, second) => first.installName.localeCompare(second.installName))
  );

  return sources;
}

function syncSkillDirectory(sourcePath: string, installPath: string) {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedInstallPath = path.resolve(installPath);
  if (resolvedSource === resolvedInstallPath) return;

  rmSync(resolvedInstallPath, { force: true, recursive: true });
  mkdirSync(path.dirname(resolvedInstallPath), { recursive: true });
  cpSync(resolvedSource, resolvedInstallPath, {
    filter: (source) => !path.relative(resolvedSource, source).split(path.sep).includes(".git"),
    recursive: true
  });
}

function readInstalledSkillFromDirectory(
  installPath: string,
  {
    sourceUrl
  }: {
    sourceUrl?: string;
  } = {}
): InstalledSkill {
  const rootSkillPath = path.join(installPath, "SKILL.md");
  if (!existsSync(rootSkillPath)) {
    throw new Error("Installed repository does not contain a root SKILL.md.");
  }

  const rootSkill = parseSkillMarkdown(readFileSync(rootSkillPath, "utf8"), "SKILL.md");
  const skillId = path.basename(installPath);
  const prompt = formatStoredSkillPrompt({
    root: rootSkill,
    subSkills: readSubSkills(installPath)
  });

  return {
    installPath,
    skill: {
      id: skillId,
      title: rootSkill.name,
      category: inferSkillCategory([skillId, rootSkill.name, rootSkill.description, prompt].join("\n")),
      description: truncateForField(rootSkill.description || `Imported skill from ${sourceUrl ?? "local folder"}.`, 240),
      prompt,
      appliesTo: "both",
      defaultEnabled: false,
      isArchived: false
    }
  };
}

export function stripSkillRuntimeMetadata(prompt: string) {
  const lines = prompt.trim().split(/\r?\n/);
  const hasStoredRuntimeMetadata = lines.some(isStoredRuntimeMetadataLine);
  if (!hasStoredRuntimeMetadata) return prompt;

  const rootIndex = lines.findIndex((line) => line.trim() === "# Root Skill");
  if (rootIndex >= 0) return lines.slice(rootIndex).join("\n").trim();
  return lines.filter((line) => !isStoredRuntimeMetadataLine(line)).join("\n").trim();
}

export function parseSkillMarkdown(markdown: string, sourcePath: string) {
  const parsed = splitFrontMatter(markdown);
  const body = parsed.body.trim() || markdown.trim();
  const fallbackName = skillNameFromPath(sourcePath);
  const name = truncateForField(parsed.attributes.name || fallbackName, 40);
  const description = truncateForField(
    parsed.attributes.description || firstMarkdownParagraph(body) || `从 ${sourcePath} 导入的 Skill。`,
    240
  );

  return {
    body,
    description,
    name,
    sourcePath
  };
}

function parseGitHubRepositoryUrl(sourceUrl: string) {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new UnsupportedSkillSourceError(sourceUrl);
  }

  if (url.hostname !== "github.com") {
    throw new UnsupportedSkillSourceError(sourceUrl);
  }

  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo) {
    throw new UnsupportedSkillSourceError(sourceUrl);
  }

  return { owner, repo };
}

function readSubSkills(installPath: string) {
  const skillsPath = path.join(installPath, "skills");
  if (!existsSync(skillsPath)) return [];

  return readdirSync(skillsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillPath = path.join(skillsPath, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) return null;
      return parseSkillMarkdown(readFileSync(skillPath, "utf8"), `skills/${entry.name}/SKILL.md`);
    })
    .filter((skill): skill is ReturnType<typeof parseSkillMarkdown> => Boolean(skill))
    .sort((first, second) => first.name.localeCompare(second.name));
}

function formatStoredSkillPrompt({
  root,
  subSkills
}: {
  root: ParsedSkillMarkdown;
  subSkills: ParsedSkillMarkdown[];
}) {
  return [
    "# Root Skill",
    root.body,
    ...(subSkills.length
      ? [
          "",
          "# 可渐进加载的 Skill 文档",
          ...subSkills.map((skill) => `- ${skill.name}（${skill.sourcePath}）：${skill.description}`)
        ]
      : [])
  ].join("\n");
}

function isStoredRuntimeMetadataLine(line: string) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("此 Skill 已安装在：") ||
    trimmed.startsWith("来源：") ||
    trimmed === "Tritree 是当前 agent runtime。生成选项或草稿时，请按以下 SKILL.md 指令判断是否需要调用可用工具。" ||
    trimmed === "子 Skill 文档不会预先展开；需要更具体的平台流程、命令说明或风格规则时，先调用 load_skill_document 渐进加载对应 SKILL.md。" ||
    trimmed === "如果需要外部平台参考资料、账号状态或登录流程，可以调用 run_skill_command；命令会由 Tritree runtime 按当前 Skill execution mode 隔离运行。" ||
    trimmed === "生成草稿或选项时，只调用与当前任务直接相关的命令；除非用户明确要求发布或互动，不要主动执行发布、评论、点赞、收藏等平台动作。"
  );
}

function isSafeSkillDirectoryName(value: string) {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

async function defaultRunCommand(command: string, args: string[]) {
  await execFileAsync(command, args, { timeout: 120000 });
}

function splitFrontMatter(markdown: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { attributes: {} as Record<string, string>, body: markdown };
  return {
    attributes: parseFrontMatterAttributes(match[1]),
    body: markdown.slice(match[0].length)
  };
}

function parseFrontMatterAttributes(frontMatter: string) {
  const attributes: Record<string, string> = {};
  const lines = frontMatter.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const blockMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*[>|]\s*$/);
    if (blockMatch) {
      const blockLines: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index].startsWith(" ") || lines[index].startsWith("\t") || lines[index] === "")) {
        blockLines.push(lines[index].replace(/^\s{1,4}/, ""));
        index += 1;
      }
      index -= 1;
      attributes[blockMatch[1]] = blockLines.join("\n").trim();
      continue;
    }

    const simpleMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!simpleMatch) continue;
    attributes[simpleMatch[1]] = stripQuotes(simpleMatch[2].trim());
  }

  return attributes;
}

function firstMarkdownHeading(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim() ?? "")
    .find(Boolean);
}

function firstMarkdownParagraph(markdown: string) {
  return markdown
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"));
}

function skillNameFromPath(sourcePath: string) {
  const parts = sourcePath.split("/").filter(Boolean);
  return parts.at(-2) || parts.at(-1)?.replace(/\.md$/i, "") || "skill";
}

function stripQuotes(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function inferSkillCategory(text: string): SkillCategory {
  const normalized = text.toLowerCase();
  if (/小红书|xhs|发布|发帖|登录|搜索|评论|点赞|收藏|平台|社交/.test(normalized)) return "平台";
  if (/风格|语气|口语|短句|标题|style|tone/.test(normalized)) return "风格";
  if (/检查|审查|校对|风险|review|audit|check/.test(normalized)) return "检查";
  if (/约束|必须|禁止|规则|constraint|rule/.test(normalized)) return "约束";
  return "方向";
}

function truncateForField(text: string, maxLength: number) {
  return Array.from(text.replace(/\s+/g, " ").trim()).slice(0, maxLength).join("");
}

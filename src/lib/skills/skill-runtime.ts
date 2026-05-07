import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createTool } from "@mastra/core/tools";
import type { ToolsInput } from "@mastra/core/agent";
import { z } from "zod";
import type { Skill } from "@/lib/domain";
import { defaultSkillInstallRoot, parseSkillMarkdown } from "./skill-installer";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 45000;

export type SkillCommandRunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
};

export type SkillCommandRunResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export type SkillCommandRunner = (
  command: string,
  args: string[],
  options: SkillCommandRunOptions
) => Promise<SkillCommandRunResult>;

export type SkillExecutionMode = "auto" | "trusted-host" | "macos-seatbelt";

export type InstalledSkillCommandInput = {
  args?: string[];
  executionMode?: SkillExecutionMode;
  installRoot?: string;
  runRoot?: string;
  runCommand?: SkillCommandRunner;
  skillName: string;
  stateRoot?: string;
  subcommand: string;
  timeoutMs?: number;
};

export type InstalledSkillCommandOutput = {
  exitCode: number;
  json?: unknown;
  ok: boolean;
  stderr: string;
  stdout: string;
};

export type SkillDocumentSummary = {
  description: string;
  name: string;
  path: string;
};

export type InstalledSkillDocumentInput = {
  document: string;
  installRoot?: string;
  skillName: string;
};

export type InstalledSkillDocumentOutput = {
  content: string;
  ok: true;
  path: string;
  skillName: string;
};

type InstalledSkillDocumentEntry = SkillDocumentSummary & {
  content: string;
  filePath: string;
  parsed: ReturnType<typeof parseSkillMarkdown>;
};

export function defaultSkillStateRoot() {
  return path.join(process.cwd(), ".tritree", "skill-state");
}

export function defaultSkillRunRoot() {
  return path.join(process.cwd(), ".tritree", "runs");
}

export function defaultSkillExecutionMode(env: Record<string, string | undefined> = process.env): SkillExecutionMode {
  const mode = env.TRITREE_SKILL_EXECUTION_MODE;
  if (!mode) return "auto";
  if (mode === "auto" || mode === "trusted-host" || mode === "macos-seatbelt") return mode;
  throw new Error(`Unsupported TRITREE_SKILL_EXECUTION_MODE: ${mode}.`);
}

export function listInstalledSkillDocuments(
  installRoot = defaultSkillInstallRoot(),
  skillName: string
): SkillDocumentSummary[] {
  return readInstalledSkillDocuments(installRoot, skillName).map(({ description, name, path: documentPath }) => ({
    description,
    name,
    path: documentPath
  }));
}

export function loadInstalledSkillDocument({
  document,
  installRoot = defaultSkillInstallRoot(),
  skillName
}: InstalledSkillDocumentInput): InstalledSkillDocumentOutput {
  const documents = readInstalledSkillDocuments(installRoot, skillName);
  const relativePath = resolveRequestedSkillDocumentPath(document, documents);
  const entry = documents.find((item) => item.path === relativePath);
  if (!entry) {
    throw new Error(
      `Skill document ${document} was not found. 可加载文档：${documents.map((item) => `${item.name}(${item.path})`).join("、") || "无"}。`
    );
  }

  return {
    content: entry.content,
    ok: true,
    path: entry.path,
    skillName
  };
}

export async function runInstalledSkillCommand({
  args = [],
  executionMode = "auto",
  installRoot = defaultSkillInstallRoot(),
  runRoot = defaultSkillRunRoot(),
  runCommand = defaultRunSkillCommand,
  skillName,
  stateRoot,
  subcommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
}: InstalledSkillCommandInput): Promise<InstalledSkillCommandOutput> {
  assertSafePathSegment(skillName, "skillName");
  assertSafeSubcommand(subcommand);
  assertSafeArgs(args);

  const skillDir = resolveInstalledSkillDir(installRoot, skillName);
  const cliPath = path.join(skillDir, "scripts", "cli.py");
  if (!existsSync(cliPath)) {
    throw new Error(`Installed skill ${skillName} does not expose scripts/cli.py.`);
  }

  const mode = resolveExecutionMode(executionMode);
  const resolvedStateRoot = stateRoot ?? (mode === "macos-seatbelt" ? defaultSkillStateRoot() : undefined);
  const commandEnv = resolvedStateRoot ? runtimeEnvironmentForSkill(resolvedStateRoot, skillName, mode) : undefined;
  const command = "uv";
  const commandArgs = ["run", "python", "scripts/cli.py", subcommand, ...args];
  const sandboxed = mode === "macos-seatbelt"
    ? wrapWithMacSeatbelt({
        command,
        commandArgs,
        runRoot,
        skillName,
        stateDir: path.join(resolvedStateRoot ?? defaultSkillStateRoot(), skillName)
      })
    : { command, commandArgs };

  const result = await runCommand(sandboxed.command, sandboxed.commandArgs, {
    cwd: skillDir,
    env: commandEnv,
    timeoutMs
  });

  return {
    exitCode: result.exitCode,
    json: parseJsonOutput(result.stdout),
    ok: result.exitCode === 0,
    stderr: result.stderr,
    stdout: result.stdout
  };
}

export async function createSkillRuntimeTools(
  enabledSkills: Skill[],
  {
    installRoot = defaultSkillInstallRoot(),
    executionMode = defaultSkillExecutionMode(),
    runCommand,
    stateRoot = defaultSkillStateRoot()
  }: {
    executionMode?: SkillExecutionMode;
    installRoot?: string;
    runCommand?: SkillCommandRunner;
    stateRoot?: string;
  } = {}
): Promise<{ availableSkillSummaries: string[]; enabledSkills: Skill[]; toolSummaries: string[]; tools: ToolsInput }> {
  const installedSkillNames = enabledSkills
    .map((skill) => skill.id)
    .filter((skillName) => isInstalledSkill(installRoot, skillName));
  const executableSkillNames = installedSkillNames
    .filter((skillName) => isInstalledExecutableSkill(installRoot, skillName));
  const progressiveEnabledSkills = enabledSkills.map((skill) =>
    installedSkillNames.includes(skill.id) ? compactInstalledSkillPrompt(skill, installRoot) : skill
  );
  const availableSkillSummaries = installedSkillNames.flatMap((skillName) => skillDocumentSummaryLines(installRoot, skillName));
  const toolSummaries: string[] = [];
  const tools: ToolsInput = {};

  if (installedSkillNames.length === 0) {
    return { availableSkillSummaries: [], enabledSkills, toolSummaries: [], tools: {} };
  }

  const loadSkillDocument = createTool({
    id: "load_skill_document",
    description:
      "Progressively load an installed Tritree skill document. Use this before relying on child-skill details that were listed but not expanded in the active instructions.",
    inputSchema: z.object({
      document: z
        .string()
        .min(1)
        .describe("Document name or path, for example SKILL.md, xhs-explore, skills/xhs-explore, or skills/xhs-explore/SKILL.md."),
      skillName: z.enum(installedSkillNames as [string, ...string[]]).describe("Installed skill name.")
    }),
    execute: async ({ document, skillName }) => loadInstalledSkillDocument({ document, installRoot, skillName })
  });
  tools.load_skill_document = loadSkillDocument;
  toolSummaries.push(
    `load_skill_document：渐进加载已安装 Skill 的 root 或子 Skill 文档。可用 Skill：${installedSkillNames.join("、")}。当任务需要子 Skill 的具体流程、命令参数或规则细节时先加载对应文档；未加载前不要假设子文档正文。`
  );

  if (executableSkillNames.length > 0) {
    const runSkillCommand = createTool({
      id: "run_skill_command",
      description:
        "Run a command from an installed Tritree skill. Use the skill's documented CLI subcommands to inspect, authenticate, or gather external reference material before producing the final structured Tritree output.",
      inputSchema: z.object({
        args: z.array(z.string()).default([]).describe("CLI arguments for the skill subcommand, for example ['--keyword', '青岛旅游攻略']."),
        skillName: z.enum(executableSkillNames as [string, ...string[]]).describe("Installed executable skill name."),
        subcommand: z.string().min(1).describe("Skill CLI subcommand, for example search-feeds, check-login, or login.")
      }),
      execute: async ({ args, skillName, subcommand }) =>
        runInstalledSkillCommand({
          args,
          executionMode,
          installRoot,
          runCommand,
          skillName,
          stateRoot,
          subcommand
        })
    });
    tools.run_skill_command = runSkillCommand;
    toolSummaries.push(
      `run_skill_command：运行已安装 Skill 的脚本命令。可用 Skill：${executableSkillNames.join("、")}。命令会作为安全 argv 传入，不经过 shell；进程隔离由当前 Skill execution mode 负责。若命令因可选参数失败，先去掉筛选、排序等可选参数，用最小等价命令重试一次。`
    );
  }

  return {
    availableSkillSummaries,
    enabledSkills: progressiveEnabledSkills,
    toolSummaries,
    tools
  };
}

function readInstalledSkillDocuments(installRoot: string, skillName: string): InstalledSkillDocumentEntry[] {
  assertSafePathSegment(skillName, "skillName");
  const skillDir = resolveInstalledSkillDir(installRoot, skillName);
  const rootPath = path.join(skillDir, "SKILL.md");
  const documents: InstalledSkillDocumentEntry[] = [];

  if (existsSync(rootPath)) {
    documents.push(readSkillDocumentEntry(rootPath, "SKILL.md"));
  }

  const childRoot = path.join(skillDir, "skills");
  if (existsSync(childRoot)) {
    documents.push(
      ...readdirSync(childRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const documentPath = path.join(childRoot, entry.name, "SKILL.md");
          if (!existsSync(documentPath)) return null;
          return readSkillDocumentEntry(documentPath, `skills/${entry.name}/SKILL.md`);
        })
        .filter((entry): entry is InstalledSkillDocumentEntry => Boolean(entry))
    );
  }

  return documents.sort((first, second) => {
    if (first.path === "SKILL.md") return -1;
    if (second.path === "SKILL.md") return 1;
    return first.name.localeCompare(second.name);
  });
}

function readSkillDocumentEntry(filePath: string, sourcePath: string): InstalledSkillDocumentEntry {
  const content = readFileSync(filePath, "utf8");
  const parsed = parseSkillMarkdown(content, sourcePath);
  return {
    content,
    description: parsed.description,
    filePath,
    name: parsed.name,
    parsed,
    path: sourcePath
  };
}

function resolveRequestedSkillDocumentPath(document: string, documents: InstalledSkillDocumentEntry[]) {
  const normalized = document.trim().replace(/\\/g, "/");
  if (!normalized || normalized === "." || normalized === "root" || normalized.toLowerCase() === "skill.md") {
    return "SKILL.md";
  }

  const exactMatch = documents.find((item) => {
    const childDirectory = item.path.match(/^skills\/([^/]+)\/SKILL\.md$/)?.[1];
    return item.path === normalized || item.name === normalized || childDirectory === normalized;
  });
  if (exactMatch) return exactMatch.path;

  return normalizeSkillDocumentPath(normalized);
}

function normalizeSkillDocumentPath(document: string) {
  const parts = document.split("/").filter(Boolean);
  if (
    document.includes("\0") ||
    path.isAbsolute(document) ||
    parts.includes("..") ||
    parts.includes(".")
  ) {
    throw new Error("Skill document must be a root SKILL.md or a child skills/<name>/SKILL.md.");
  }

  if (parts.length === 1) {
    assertSafePathSegment(parts[0], "document");
    return `skills/${parts[0]}/SKILL.md`;
  }

  if (parts.length === 2 && parts[0] === "skills") {
    assertSafePathSegment(parts[1], "document");
    return `skills/${parts[1]}/SKILL.md`;
  }

  if (parts.length === 3 && parts[0] === "skills" && parts[2] === "SKILL.md") {
    assertSafePathSegment(parts[1], "document");
    return `skills/${parts[1]}/SKILL.md`;
  }

  throw new Error("Skill document must be a root SKILL.md or a child skills/<name>/SKILL.md.");
}

function skillDocumentSummaryLines(installRoot: string, skillName: string) {
  try {
    return listInstalledSkillDocuments(installRoot, skillName)
      .filter((document) => document.path !== "SKILL.md")
      .map((document) => `- ${skillName}/${document.name}（${document.path}）：${document.description}`);
  } catch {
    return [];
  }
}

function compactInstalledSkillPrompt(skill: Skill, installRoot: string): Skill {
  try {
    const skillDir = resolveInstalledSkillDir(installRoot, skill.id);
    const documents = readInstalledSkillDocuments(installRoot, skill.id);
    const root = documents.find((document) => document.path === "SKILL.md");
    if (!root) return skill;
    const childDocuments = documents.filter((document) => document.path !== "SKILL.md");
    const prompt = [
      `此 Skill 已安装在：${skillDir}`,
      "Tritree 是当前 agent runtime。生成选项或草稿时，请按以下 SKILL.md 指令判断是否需要调用可用工具。",
      "子 Skill 文档不会预先展开；需要更具体的平台流程、命令说明或风格规则时，先调用 load_skill_document 渐进加载对应 SKILL.md。",
      "如果需要外部平台参考资料、账号状态或登录流程，可以调用 run_skill_command；命令会由 Tritree runtime 按当前 Skill execution mode 隔离运行。",
      "生成草稿或选项时，只调用与当前任务直接相关的命令；除非用户明确要求发布或互动，不要主动执行发布、评论、点赞、收藏等平台动作。",
      "",
      "# Root Skill",
      root.parsed.body,
      ...(childDocuments.length
        ? [
            "",
            "# 可渐进加载的 Skill 文档",
            ...childDocuments.map((document) => `- ${document.name}（${document.path}）：${document.description}`)
          ]
        : [])
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n");

    return { ...skill, description: skill.description || root.description, prompt };
  } catch {
    return skill;
  }
}

function resolveExecutionMode(mode: SkillExecutionMode): Exclude<SkillExecutionMode, "auto"> {
  if (mode !== "auto") return mode;
  return process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") ? "macos-seatbelt" : "trusted-host";
}

async function defaultRunSkillCommand(
  command: string,
  args: string[],
  options: SkillCommandRunOptions
): Promise<SkillCommandRunResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs
    });
    return { exitCode: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    if (isExecFileError(error)) {
      const stderr = typeof error.stderr === "string" ? error.stderr : "";
      const stdout = typeof error.stdout === "string" ? error.stdout : "";
      return {
        exitCode: typeof error.code === "number" ? error.code : 1,
        stderr: stderr || (stdout ? "" : execFileErrorMessage(error)),
        stdout
      };
    }
    throw error;
  }
}

function execFileErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Skill command failed without stdout or stderr.";
}

function resolveInstalledSkillDir(installRoot: string, skillName: string) {
  const root = path.resolve(installRoot);
  const skillDir = path.resolve(root, skillName);
  if (skillDir !== root && skillDir.startsWith(`${root}${path.sep}`) && existsSync(skillDir)) {
    return skillDir;
  }
  throw new Error(`Installed skill ${skillName} was not found.`);
}

function isInstalledSkill(installRoot: string, skillName: string) {
  try {
    assertSafePathSegment(skillName, "skillName");
    return existsSync(path.join(resolveInstalledSkillDir(installRoot, skillName), "SKILL.md"));
  } catch {
    return false;
  }
}

function isInstalledExecutableSkill(installRoot: string, skillName: string) {
  try {
    assertSafePathSegment(skillName, "skillName");
    return existsSync(path.join(resolveInstalledSkillDir(installRoot, skillName), "scripts", "cli.py"));
  } catch {
    return false;
  }
}

function assertSafePathSegment(value: string, field: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`${field} must be a safe path segment.`);
  }
}

function assertSafeSubcommand(subcommand: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(subcommand)) {
    throw new Error("Skill subcommand must be a safe CLI token.");
  }
}

function assertSafeArgs(args: string[]) {
  for (const arg of args) {
    if (arg.includes("\0")) {
      throw new Error("Skill command arguments cannot contain null bytes.");
    }
  }
}

function runtimeEnvironmentForSkill(
  stateRoot: string,
  skillName: string,
  mode: Exclude<SkillExecutionMode, "auto">
): NodeJS.ProcessEnv {
  const skillStateRoot = path.join(stateRoot, skillName);
  const home = path.join(skillStateRoot, "home");
  const cache = path.join(skillStateRoot, "cache");
  const config = path.join(skillStateRoot, "config");
  const tmp = path.join(skillStateRoot, "tmp");
  const uvCache = path.join(skillStateRoot, "uv-cache");
  const uvEnvironment = path.join(skillStateRoot, "venv");
  for (const dir of [home, cache, config, tmp, uvCache, uvEnvironment]) {
    mkdirSync(dir, { recursive: true });
  }

  return {
    ...passthroughEnvironment(),
    ...(mode === "macos-seatbelt" ? { HOME: home, XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: config } : {}),
    TMPDIR: tmp,
    UV_CACHE_DIR: uvCache,
    UV_LINK_MODE: "copy",
    UV_PROJECT_ENVIRONMENT: uvEnvironment
  };
}

function wrapWithMacSeatbelt({
  command,
  commandArgs,
  runRoot,
  skillName,
  stateDir
}: {
  command: string;
  commandArgs: string[];
  runRoot: string;
  skillName: string;
  stateDir: string;
}) {
  const profileDir = path.join(runRoot, "sandbox-profiles");
  mkdirSync(profileDir, { recursive: true });
  const profilePath = path.join(profileDir, `${skillName}-${randomUUID()}.sb`);
  writeFileSync(
    profilePath,
    buildMacSeatbeltProfile({
      runRoot,
      stateDir
    })
  );

  return {
    command: "sandbox-exec",
    commandArgs: ["-f", profilePath, command, ...commandArgs]
  };
}

function buildMacSeatbeltProfile({
  runRoot,
  stateDir
}: {
  runRoot: string;
  stateDir: string;
}) {
  const writeSubpaths = [stateDir, runRoot];

  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read*)",
    formatSeatbeltRule("file-write*", writeSubpaths, ["/dev/null"]),
    "(allow network*)",
    ""
  ].join("\n");
}

function formatSeatbeltRule(operation: string, subpaths: string[], literals: string[] = []) {
  return [
    `(allow ${operation}`,
    ...literals.map((literal) => `  (literal ${seatbeltString(path.resolve(literal))})`),
    ...subpaths.map((subpath) => `  (subpath ${seatbeltString(path.resolve(subpath))})`),
    ")"
  ].join("\n");
}

function seatbeltString(value: string) {
  return JSON.stringify(value);
}

function passthroughEnvironment(): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy"
  ];

  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "development" };
  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function parseJsonOutput(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function isExecFileError(error: unknown): error is NodeJS.ErrnoException & {
  code?: number | string;
  stderr?: string;
  stdout?: string;
} {
  return typeof error === "object" && error !== null && ("stdout" in error || "stderr" in error || "code" in error);
}

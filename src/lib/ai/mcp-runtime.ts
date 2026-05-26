import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ToolsInput } from "@mastra/core/agent";
import { MCPClient, type MastraMCPServerDefinition } from "@mastra/mcp";

type StringEnv = Record<string, string | undefined>;

export type McpRuntimeTools = {
  diagnostics: string[];
  disconnect: () => Promise<void>;
  toolLabels: Record<string, string>;
  toolSummaries: string[];
  tools: ToolsInput;
};

type McpRuntimeOptions = {
  configPath?: string;
  createClient?: (options: {
    id: string;
    servers: Record<string, MastraMCPServerDefinition>;
  }) => McpClientLike;
  cwd?: string;
  env?: StringEnv;
  existingTools?: ToolsInput;
  log?: (message: string) => void;
};

export type McpClientLike = {
  disconnect?: () => Promise<void> | void;
  listTools?: () => Promise<ToolsInput>;
  listToolsetsWithErrors?: () => Promise<{
    errors: Record<string, string>;
    toolsets: Record<string, ToolsInput>;
  }>;
};

type LoadServerDefinitionsOptions = {
  configPath: string;
  env?: StringEnv;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
};

type LoadServerDefinitionsResult = {
  configHash: string;
  diagnostics: string[];
  serverLabels: Record<string, string>;
  servers: Record<string, MastraMCPServerDefinition>;
};

const SERVER_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const ENV_PLACEHOLDER_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MCP_TOOL_CALL_LIMIT = 5;
const MCP_TOOL_CALL_LIMIT_ENV = "TRITREE_MCP_TOOL_CALL_LIMIT";
const STDIO_NORMALIZED_KEYS = new Set(["args", "command", "cwd", "disabled", "env", "label", "roots", "timeout"]);
const HTTP_NORMALIZED_KEYS = new Set(["connectTimeout", "disabled", "headers", "label", "requestInit", "roots", "timeout", "url"]);

export function defaultMcpConfigPath(cwd = process.cwd()) {
  return path.join(cwd, ".tritree", "mcp.json");
}

export function resolveMcpConfigPath({
  cwd = process.cwd(),
  env = process.env
}: {
  cwd?: string;
  env?: StringEnv;
} = {}) {
  const configuredPath = env.TRITREE_MCP_CONFIG_PATH?.trim();
  if (!configuredPath) return defaultMcpConfigPath(cwd);
  if (!path.isAbsolute(configuredPath)) {
    throw new Error("TRITREE_MCP_CONFIG_PATH must be an absolute path.");
  }
  return configuredPath;
}

export function loadMcpServerDefinitions({
  configPath,
  env = process.env,
  exists = existsSync,
  readFile = (filePath) => readFileSync(filePath, "utf8")
}: LoadServerDefinitionsOptions): LoadServerDefinitionsResult {
  if (!exists(configPath)) {
    return { configHash: "", diagnostics: [], serverLabels: {}, servers: {} };
  }

  let configText: string;
  try {
    configText = readFile(configPath);
  } catch (error) {
    return {
      configHash: "",
      diagnostics: [`MCP config ${configPath} could not be read: ${redactMcpDiagnostic(errorMessage(error))}`],
      serverLabels: {},
      servers: {}
    };
  }

  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(configText);
  } catch (error) {
    return {
      configHash: hashConfig(configText),
      diagnostics: [`MCP config ${configPath} is not valid JSON: ${redactMcpDiagnostic(errorMessage(error))}`],
      serverLabels: {},
      servers: {}
    };
  }

  if (!isRecord(rawConfig)) {
    return {
      configHash: hashConfig(configText),
      diagnostics: [`MCP config ${configPath} must be a JSON object.`],
      serverLabels: {},
      servers: {}
    };
  }
  const mcpServers = rawConfig.mcpServers;
  if (mcpServers === undefined) {
    return { configHash: hashConfig(configText), diagnostics: [], serverLabels: {}, servers: {} };
  }
  if (!isRecord(mcpServers)) {
    return {
      configHash: hashConfig(configText),
      diagnostics: ["MCP config mcpServers must be an object."],
      serverLabels: {},
      servers: {}
    };
  }

  const diagnostics: string[] = [];
  const serverLabels: Record<string, string> = {};
  const servers: Record<string, MastraMCPServerDefinition> = {};
  for (const [serverName, rawServer] of Object.entries(mcpServers)) {
    const parsed = parseServerDefinition(serverName, rawServer, env);
    diagnostics.push(...parsed.diagnostics.map(redactMcpDiagnostic));
    if (parsed.server) {
      servers[serverName] = parsed.server;
      if (parsed.label) serverLabels[serverName] = parsed.label;
    }
  }

  return {
    configHash: hashConfig(configText),
    diagnostics,
    serverLabels,
    servers
  };
}

function parseServerDefinition(
  serverName: string,
  rawServer: unknown,
  env: StringEnv
): { diagnostics: string[]; label?: string; server?: MastraMCPServerDefinition } {
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    return { diagnostics: [`MCP server ${serverName} has an invalid name.`] };
  }
  if (!isRecord(rawServer)) {
    return { diagnostics: [`MCP server ${serverName} must be an object.`] };
  }
  if (rawServer.disabled === true) {
    return { diagnostics: [] };
  }

  const label = typeof rawServer.label === "string" ? rawServer.label.trim() || undefined : undefined;

  const hasCommand = typeof rawServer.command === "string";
  const hasUrl = typeof rawServer.url === "string";
  if (hasCommand === hasUrl) {
    return { diagnostics: [`MCP server ${serverName} must define exactly one of command or url.`] };
  }

  const parsed = hasCommand
    ? parseStdioServerDefinition(serverName, rawServer, env)
    : parseHttpServerDefinition(serverName, rawServer, env);

  return { ...parsed, ...(label ? { label } : {}) };
}

function parseStdioServerDefinition(
  serverName: string,
  rawServer: Record<string, unknown>,
  env: StringEnv
): { diagnostics: string[]; server?: MastraMCPServerDefinition } {
  const diagnostics: string[] = [];
  const command = expandString(rawServer.command as string, env);
  if (!command.value.trim()) diagnostics.push(`MCP server ${serverName} command must not be empty.`);
  diagnostics.push(...command.diagnostics.map((message) => `MCP server ${serverName}: ${message}`));

  const args = readStringArray(rawServer.args, `MCP server ${serverName} args`, env, diagnostics);
  const serverEnv = readStringMap(rawServer.env, `MCP server ${serverName} env`, env, diagnostics);
  const cwd = readOptionalAbsolutePath(rawServer.cwd, `MCP server ${serverName} cwd`, env, diagnostics);
  const timeout = readOptionalTimeout(rawServer.timeout, `MCP server ${serverName} timeout`, diagnostics);
  const roots = readRoots(rawServer.roots, `MCP server ${serverName} roots`, env, diagnostics);
  const passthrough = readPassthroughServerOptions(rawServer, STDIO_NORMALIZED_KEYS, `MCP server ${serverName}`, env, diagnostics);
  if (diagnostics.length > 0) return { diagnostics };

  return {
    diagnostics: [],
    server: {
      ...passthrough,
      command: command.value,
      ...(args ? { args } : {}),
      ...(cwd ? { cwd } : {}),
      ...(serverEnv ? { env: serverEnv } : {}),
      ...(roots ? { roots } : {}),
      ...(timeout ? { timeout } : {})
    }
  };
}

function parseHttpServerDefinition(
  serverName: string,
  rawServer: Record<string, unknown>,
  env: StringEnv
): { diagnostics: string[]; server?: MastraMCPServerDefinition } {
  const diagnostics: string[] = [];
  const rawUrl = expandString(String(rawServer.url), env);
  diagnostics.push(...rawUrl.diagnostics.map((message) => `MCP server ${serverName}: ${message}`));

  let url: URL | undefined;
  try {
    url = new URL(rawUrl.value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      diagnostics.push(`MCP server ${serverName} url must use http or https.`);
    }
  } catch {
    diagnostics.push(`MCP server ${serverName} url must be an absolute URL.`);
  }

  const requestInit = readRequestInit(rawServer.requestInit, `MCP server ${serverName} requestInit`, env, diagnostics);
  const headers = readStringMap(rawServer.headers, `MCP server ${serverName} headers`, env, diagnostics);
  const timeout = readOptionalTimeout(rawServer.timeout, `MCP server ${serverName} timeout`, diagnostics);
  const connectTimeout = readOptionalTimeout(
    rawServer.connectTimeout,
    `MCP server ${serverName} connectTimeout`,
    diagnostics
  );
  const roots = readRoots(rawServer.roots, `MCP server ${serverName} roots`, env, diagnostics);
  const passthrough = readPassthroughServerOptions(rawServer, HTTP_NORMALIZED_KEYS, `MCP server ${serverName}`, env, diagnostics);
  if (diagnostics.length > 0 || !url) return { diagnostics };

  return {
    diagnostics: [],
    server: {
      ...passthrough,
      url,
      ...(connectTimeout ? { connectTimeout } : {}),
      ...mergeHttpHeaders(requestInit, headers),
      ...(roots ? { roots } : {}),
      ...(timeout ? { timeout } : {})
    }
  };
}

function readStringArray(
  value: unknown,
  label: string,
  env: StringEnv,
  diagnostics: string[]
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    diagnostics.push(`${label} must be an array of strings.`);
    return undefined;
  }

  const expanded: string[] = [];
  for (const item of value) {
    const result = expandString(item, env);
    diagnostics.push(...result.diagnostics.map((message) => `${label}: ${message}`));
    expanded.push(result.value);
  }
  return expanded;
}

function readStringMap(
  value: unknown,
  label: string,
  env: StringEnv,
  diagnostics: string[]
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
    diagnostics.push(`${label} must be a string map.`);
    return undefined;
  }

  const expanded: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const result = expandString(item as string, env);
    diagnostics.push(...result.diagnostics.map((message) => `${label}.${key}: ${message}`));
    expanded[key] = result.value;
  }
  return expanded;
}

function readRequestInit(
  value: unknown,
  label: string,
  env: StringEnv,
  diagnostics: string[]
): RequestInit | undefined {
  if (value === undefined) return undefined;
  const expanded = expandConfigValue(value, label, env, diagnostics);
  if (!isRecord(expanded)) {
    diagnostics.push(`${label} must be an object.`);
    return undefined;
  }

  return expanded as RequestInit;
}

function readPassthroughServerOptions(
  rawServer: Record<string, unknown>,
  normalizedKeys: Set<string>,
  label: string,
  env: StringEnv,
  diagnostics: string[]
) {
  const passthrough = Object.fromEntries(
    Object.entries(rawServer).filter(([key]) => !normalizedKeys.has(key))
  );
  return expandConfigValue(passthrough, label, env, diagnostics) as Record<string, unknown>;
}

function readOptionalAbsolutePath(value: unknown, label: string, env: StringEnv, diagnostics: string[]) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    diagnostics.push(`${label} must be an absolute path.`);
    return undefined;
  }

  const expanded = expandString(value, env);
  diagnostics.push(...expanded.diagnostics.map((message) => `${label}: ${message}`));
  if (!path.isAbsolute(expanded.value)) {
    diagnostics.push(`${label} must be an absolute path.`);
    return undefined;
  }
  return expanded.value;
}

function readOptionalTimeout(value: unknown, label: string, diagnostics: string[]) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    diagnostics.push(`${label} must be an integer from 1 to ${MAX_TIMEOUT_MS}.`);
    return undefined;
  }
  return value;
}

function readRoots(
  value: unknown,
  label: string,
  env: StringEnv,
  diagnostics: string[]
): Array<{ uri: string; name?: string }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    diagnostics.push(`${label} must be an array.`);
    return undefined;
  }

  const roots: Array<{ uri: string; name?: string }> = [];
  for (const [index, root] of value.entries()) {
    if (!isRecord(root) || typeof root.uri !== "string") {
      diagnostics.push(`${label}[${index}] must include a file URI.`);
      continue;
    }
    const uri = expandString(root.uri, env);
    diagnostics.push(...uri.diagnostics.map((message) => `${label}[${index}].uri: ${message}`));
    if (!isValidFileUri(uri.value)) {
      diagnostics.push(`${label}[${index}].uri must be a file:// URI.`);
      continue;
    }
    if (root.name !== undefined && typeof root.name !== "string") {
      diagnostics.push(`${label}[${index}].name must be a string.`);
      continue;
    }

    const name = root.name === undefined ? undefined : expandString(root.name, env);
    if (name) diagnostics.push(...name.diagnostics.map((message) => `${label}[${index}].name: ${message}`));
    roots.push({ uri: uri.value, ...(name?.value ? { name: name.value } : {}) });
  }
  return roots;
}

function isValidFileUri(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "file:" && Boolean(url.pathname) && url.pathname !== "/";
  } catch {
    return false;
  }
}

function expandString(value: string, env: StringEnv) {
  const diagnostics: string[] = [];
  const expanded = value.replace(ENV_PLACEHOLDER_PATTERN, (_match, name: string) => {
    const envValue = env[name];
    if (!envValue) {
      diagnostics.push(`${name} is not configured`);
      return "";
    }
    return envValue;
  });
  return { diagnostics, value: expanded };
}

function expandConfigValue(value: unknown, label: string, env: StringEnv, diagnostics: string[]): unknown {
  if (typeof value === "string") {
    const expanded = expandString(value, env);
    diagnostics.push(...expanded.diagnostics.map((message) => `${label}: ${message}`));
    return expanded.value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => expandConfigValue(item, `${label}[${index}]`, env, diagnostics));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        expandConfigValue(item, `${label}.${key}`, env, diagnostics)
      ])
    );
  }
  return value;
}

function mergeHttpHeaders(requestInit: RequestInit | undefined, headers: Record<string, string> | undefined) {
  if (!headers) return requestInit ? { requestInit } : {};
  if (!requestInit) return { requestInit: { headers } };
  const existingHeaders = isRecord(requestInit.headers) ? requestInit.headers : {};
  return {
    requestInit: {
      ...requestInit,
      headers: {
        ...headers,
        ...existingHeaders
      }
    }
  };
}

function hashConfig(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function redactMcpDiagnostic(message: string) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(API_KEY|TOKEN|PASSWORD|SECRET)=([^\s,}]+)/gi, "$1=[redacted]")
    .replace(/\b(api[_-]?key|token|password|secret)=([^\s,}]+)/gi, "$1=[redacted]");
}

export async function createMcpRuntimeTools(options: McpRuntimeOptions = {}): Promise<McpRuntimeTools> {
  const diagnostics: string[] = [];
  const logDiagnostic = (message: string) => {
    diagnostics.push(message);
    options.log?.(`[tritree:mcp] ${message}`);
  };

  let configPath: string;
  try {
    configPath =
      options.configPath ??
      resolveMcpConfigPath({
        cwd: options.cwd,
        env: options.env
      });
  } catch (error) {
    const diagnostic = redactMcpDiagnostic(errorMessage(error));
    logDiagnostic(diagnostic);
    return emptyMcpRuntimeTools(diagnostics);
  }
  if (!path.isAbsolute(configPath)) {
    const diagnostic = "MCP configPath must be an absolute path.";
    logDiagnostic(diagnostic);
    return emptyMcpRuntimeTools(diagnostics);
  }

  const loaded = loadMcpServerDefinitions({
    configPath,
    env: options.env
  });
  for (const diagnostic of loaded.diagnostics) logDiagnostic(diagnostic);

  if (Object.keys(loaded.servers).length === 0) {
    return emptyMcpRuntimeTools(diagnostics);
  }

  let client: McpClientLike;
  try {
    client = (options.createClient ?? createDefaultMcpClient)({
      id: `tritree-mcp-${loaded.configHash}`,
      servers: loaded.servers
    });
  } catch (error) {
    const diagnostic = redactMcpDiagnostic(`MCP client could not be created: ${errorMessage(error)}`);
    logDiagnostic(diagnostic);
    return emptyMcpRuntimeTools(diagnostics);
  }

  let toolsets: Record<string, ToolsInput>;
  try {
    if (client.listToolsetsWithErrors) {
      const listed = await client.listToolsetsWithErrors();
      toolsets = listed.toolsets;
      for (const [serverName, listError] of Object.entries(listed.errors)) {
        logDiagnostic(`MCP ${serverName} unavailable: ${redactMcpDiagnostic(listError)}`);
      }
    } else if (client.listTools) {
      toolsets = { mcp: await client.listTools() };
    } else {
      logDiagnostic("MCP client cannot list tools.");
      return {
        diagnostics,
        disconnect: () => disconnectMcpClient(client),
        toolLabels: {},
        toolSummaries: diagnostics,
        tools: {}
      };
    }
  } catch (error) {
    const diagnostic = redactMcpDiagnostic(`MCP tools unavailable: ${errorMessage(error)}`);
    logDiagnostic(diagnostic);
    await disconnectMcpClient(client, logDiagnostic);
    return emptyMcpRuntimeTools(diagnostics);
  }

  const tools: ToolsInput = {};
  const toolLabels: Record<string, string> = {};
  const toolSummaries = [...diagnostics];
  const existingTools = options.existingTools ?? {};
  const toolCallLimit = resolveMcpToolCallLimit(options.env ?? process.env);
  if (toolCallLimit.diagnostic) {
    diagnostics.push(toolCallLimit.diagnostic);
    toolSummaries.push(toolCallLimit.diagnostic);
    options.log?.(`[tritree:mcp] ${toolCallLimit.diagnostic}`);
  }
  let loadedToolCount = 0;

  for (const [serverName, serverTools] of Object.entries(toolsets)) {
    const serverLabel = loaded.serverLabels[serverName] ?? serverName;
    for (const [toolName, tool] of Object.entries(serverTools)) {
      const namespacedName = `${serverName}_${toolName}`;
      if (namespacedName in existingTools || namespacedName in tools) {
        const diagnostic = "MCP tool skipped because a tool with the same runtime name already exists.";
        diagnostics.push(diagnostic);
        toolSummaries.push(diagnostic);
        options.log?.(`[tritree:mcp] ${diagnostic}`);
        continue;
      }

      tools[namespacedName] = withMcpToolCallLimit(tool, namespacedName, toolCallLimit.limit);
      if (serverLabel !== serverName) toolLabels[namespacedName] = serverLabel;
      loadedToolCount += 1;
    }
  }

  if (loadedToolCount > 0) {
    toolSummaries.push(
      `MCP runtime tools are available through the model tool schema. Call MCP tools only when this turn's task needs their capability.`
    );
    if (toolCallLimit.limit !== null) {
      toolSummaries.push(
        `Each MCP tool is limited to ${toolCallLimit.limit} executions per turn. If a tool returns a limit result, stop retrying that tool and use the material already gathered or ask a narrower follow-up. Set ${MCP_TOOL_CALL_LIMIT_ENV}=0 to disable this guard.`
      );
    }
  }

  return {
    diagnostics,
    disconnect: () => disconnectMcpClient(client),
    toolLabels,
    toolSummaries,
    tools
  };
}

function resolveMcpToolCallLimit(env: StringEnv): { diagnostic?: string; limit: number | null } {
  const configured = env[MCP_TOOL_CALL_LIMIT_ENV]?.trim();
  if (configured === undefined || configured === "") return { limit: DEFAULT_MCP_TOOL_CALL_LIMIT };
  if (configured === "0") return { limit: null };

  const parsed = Number(configured);
  if (Number.isInteger(parsed) && parsed > 0) return { limit: parsed };

  return {
    diagnostic: `${MCP_TOOL_CALL_LIMIT_ENV} must be a non-negative integer; using default ${DEFAULT_MCP_TOOL_CALL_LIMIT}.`,
    limit: DEFAULT_MCP_TOOL_CALL_LIMIT
  };
}

function withMcpToolCallLimit<TTool>(tool: TTool, runtimeName: string, limit: number | null): TTool {
  if (limit === null || !isRecord(tool) || typeof tool.execute !== "function") return tool;

  let callCount = 0;
  const execute = tool.execute as (...args: unknown[]) => unknown;
  return {
    ...tool,
    ...(typeof tool.description === "string"
      ? {
          description: `${tool.description}\n\nRuntime guard: this MCP tool can be executed at most ${limit} times in one Tritree turn. If a limit result is returned, do not retry this tool.`
        }
      : {}),
    execute: async (...args: unknown[]) => {
      if (callCount >= limit) {
        return {
          error: `MCP tool call limit reached for ${runtimeName} after ${limit} calls; no external request was sent.`,
          limit,
          ok: false,
          toolName: runtimeName
        };
      }

      callCount += 1;
      return execute.apply(tool, args);
    }
  };
}

function createDefaultMcpClient(options: {
  id: string;
  servers: Record<string, MastraMCPServerDefinition>;
}): McpClientLike {
  // Use a unique id per request so concurrent calls do not share one MCPClient singleton
  // and one request's disconnect() cannot interrupt another request's active connection.
  return new MCPClient({ ...options, id: `${options.id}-${randomUUID()}` });
}

function emptyMcpRuntimeTools(diagnostics: string[] = []): McpRuntimeTools {
  return {
    diagnostics,
    disconnect: async () => undefined,
    toolLabels: {},
    toolSummaries: diagnostics,
    tools: {}
  };
}

async function disconnectMcpClient(client: McpClientLike, logDiagnostic?: (message: string) => void) {
  try {
    await client.disconnect?.();
  } catch (error) {
    const diagnostic = redactMcpDiagnostic(`MCP disconnect failed: ${errorMessage(error)}`);
    if (!logDiagnostic) throw new Error(diagnostic);
    logDiagnostic(diagnostic);
  }
}

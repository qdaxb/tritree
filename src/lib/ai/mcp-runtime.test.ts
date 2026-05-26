import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMcpRuntimeTools,
  defaultMcpConfigPath,
  loadMcpServerDefinitions,
  redactMcpDiagnostic,
  resolveMcpConfigPath
} from "./mcp-runtime";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "tritree-mcp-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function writeJsonConfig(dir: string, value: unknown) {
  const filePath = path.join(dir, "mcp.json");
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("MCP runtime config parsing", () => {
  it("resolves the default MCP config path under .tritree", () => {
    expect(defaultMcpConfigPath("/workspace/tritree")).toBe("/workspace/tritree/.tritree/mcp.json");
    expect(resolveMcpConfigPath({ env: {}, cwd: "/workspace/tritree" })).toBe(
      "/workspace/tritree/.tritree/mcp.json"
    );
  });

  it("uses TRITREE_MCP_CONFIG_PATH when it is absolute", () => {
    expect(
      resolveMcpConfigPath({
        env: { TRITREE_MCP_CONFIG_PATH: "/secure/tritree/mcp.json" },
        cwd: "/workspace/tritree"
      })
    ).toBe("/secure/tritree/mcp.json");
  });

  it("rejects relative TRITREE_MCP_CONFIG_PATH values", () => {
    expect(() =>
      resolveMcpConfigPath({
        env: { TRITREE_MCP_CONFIG_PATH: "relative/mcp.json" },
        cwd: "/workspace/tritree"
      })
    ).toThrow("TRITREE_MCP_CONFIG_PATH must be an absolute path");
  });

  it("returns no servers when the config file does not exist", () => {
    const dir = makeTempDir();
    const result = loadMcpServerDefinitions({
      configPath: path.join(dir, "missing.json"),
      env: {}
    });

    expect(result.servers).toEqual({});
    expect(result.diagnostics).toEqual([]);
  });

  it("returns redacted diagnostics when the config cannot be read or parsed", () => {
    const readErrorResult = loadMcpServerDefinitions({
      configPath: "/secure/mcp.json",
      env: {},
      exists: () => true,
      readFile: () => {
        throw new Error("permission denied TOKEN=real-token");
      }
    });

    expect(readErrorResult.servers).toEqual({});
    expect(readErrorResult.diagnostics.join("\n")).toContain("permission denied TOKEN=[redacted]");
    expect(readErrorResult.diagnostics.join("\n")).not.toContain("real-token");

    const invalidJsonResult = loadMcpServerDefinitions({
      configPath: "/secure/mcp.json",
      env: {},
      exists: () => true,
      readFile: () => "{ invalid"
    });

    expect(invalidJsonResult.servers).toEqual({});
    expect(invalidJsonResult.diagnostics.join("\n")).toContain("not valid JSON");
  });

  it("converts stdio and HTTP server configs into Mastra MCP definitions", () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/allowed"],
          cwd: "/tmp",
          env: {
            FILESYSTEM_TOKEN: "${FILESYSTEM_TOKEN}"
          },
          roots: [{ uri: "file:///tmp/allowed", name: "Allowed" }],
          timeout: 12000
        },
        remoteSearch: {
          url: "https://mcp.example.com/mcp",
          requestInit: {
            headers: {
              Authorization: "Bearer ${REMOTE_SEARCH_MCP_TOKEN}"
            }
          },
          connectTimeout: 2500
        },
        disabledServer: {
          disabled: true,
          command: "node",
          args: ["server.js"]
        }
      }
    });

    const result = loadMcpServerDefinitions({
      configPath,
      env: {
        FILESYSTEM_TOKEN: "fs-secret",
        REMOTE_SEARCH_MCP_TOKEN: "remote-secret"
      }
    });

    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.servers)).toEqual(["filesystem", "remoteSearch"]);
    expect(result.servers.filesystem).toMatchObject({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/allowed"],
      cwd: "/tmp",
      env: { FILESYSTEM_TOKEN: "fs-secret" },
      roots: [{ uri: "file:///tmp/allowed", name: "Allowed" }],
      timeout: 12000
    });
    expect(result.servers.remoteSearch).toMatchObject({
      requestInit: {
        headers: {
          Authorization: "Bearer remote-secret"
        }
      },
      connectTimeout: 2500
    });
    expect(result.servers.remoteSearch && "url" in result.servers.remoteSearch ? result.servers.remoteSearch.url : null)
      .toBeInstanceOf(URL);
  });

  it("accepts common MCP JSON type and top-level HTTP headers", () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        httpServer: {
          type: "http",
          url: "https://mcp.example.com/mcp",
          headers: {
            Authorization: "Bearer ${MCP_API_TOKEN}"
          }
        }
      }
    });

    const result = loadMcpServerDefinitions({
      configPath,
      env: {
        MCP_API_TOKEN: "api-secret"
      }
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.servers.httpServer).toMatchObject({
      type: "http",
      requestInit: {
        headers: {
          Authorization: "Bearer api-secret"
        }
      }
    });
    expect(result.servers.httpServer && "url" in result.servers.httpServer ? result.servers.httpServer.url : null)
      .toBeInstanceOf(URL);
  });

  it("expands environment placeholders in cwd and roots", () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        filesystem: {
          command: "npx",
          cwd: "${PROJECT_ROOT}/mcp",
          roots: [{ uri: "file://${PROJECT_ROOT}/allowed", name: "${ROOT_NAME}" }]
        }
      }
    });

    const result = loadMcpServerDefinitions({
      configPath,
      env: {
        PROJECT_ROOT: "/workspace/tritree",
        ROOT_NAME: "Allowed Root"
      }
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.servers.filesystem).toMatchObject({
      cwd: "/workspace/tritree/mcp",
      roots: [{ uri: "file:///workspace/tritree/allowed", name: "Allowed Root" }]
    });
  });

  it("skips servers when cwd or roots contain missing environment placeholders", () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        missingCwd: {
          command: "node",
          cwd: "${SECRET_PROJECT_ROOT}/mcp"
        },
        missingRoot: {
          command: "node",
          roots: [{ uri: "file://${SECRET_PROJECT_ROOT}/allowed", name: "${SECRET_ROOT_NAME}" }]
        }
      }
    });

    const result = loadMcpServerDefinitions({
      configPath,
      env: {
        SECRET_PROJECT_ROOT: undefined,
        SECRET_ROOT_NAME: undefined
      }
    });

    expect(result.servers).toEqual({});
    expect(result.diagnostics.join("\n")).toContain("SECRET_PROJECT_ROOT is not configured");
    expect(result.diagnostics.join("\n")).toContain("SECRET_ROOT_NAME is not configured");
    expect(result.diagnostics.join("\n")).not.toContain("SECRET_PROJECT_ROOT=");
    expect(result.diagnostics.join("\n")).not.toContain("SECRET_ROOT_NAME=");
  });

  it("skips only invalid transport option shapes with diagnostics", () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        lowTimeout: {
          command: "node",
          timeout: 0
        },
        highConnectTimeout: {
          url: "https://mcp.example.com/mcp",
          connectTimeout: 120001
        },
        unsupportedRequestInit: {
          url: "https://mcp.example.com/mcp",
          requestInit: {
            method: "POST",
            headers: {
              Authorization: "Bearer token"
            }
          }
        },
        nonStringEnv: {
          command: "node",
          env: {
            API_KEY: 123
          }
        },
        nonStringHeaders: {
          url: "https://mcp.example.com/mcp",
          requestInit: {
            headers: {
              Authorization: 123
            }
          }
        },
        nonArrayArgs: {
          command: "node",
          args: "server.js"
        },
        nonStringArgs: {
          command: "node",
          args: ["server.js", 123]
        },
        malformedRoot: {
          command: "node",
          roots: [{ uri: "file://bad host/allowed" }]
        }
      }
    });

    const result = loadMcpServerDefinitions({ configPath, env: {} });

    expect(Object.keys(result.servers)).toEqual(["unsupportedRequestInit", "nonStringHeaders"]);
    expect(result.servers.unsupportedRequestInit).toMatchObject({
      requestInit: {
        method: "POST",
        headers: {
          Authorization: "Bearer token"
        }
      }
    });
    expect(result.diagnostics.join("\n")).toContain("lowTimeout");
    expect(result.diagnostics.join("\n")).toContain("highConnectTimeout");
    expect(result.diagnostics.join("\n")).toContain("nonStringEnv env must be a string map");
    expect(result.diagnostics.join("\n")).toContain("nonArrayArgs args must be an array of strings");
    expect(result.diagnostics.join("\n")).toContain("nonStringArgs args must be an array of strings");
    expect(result.diagnostics.join("\n")).toContain("malformedRoot");
    expect(result.diagnostics.join("\n")).toContain("file:// URI");
  });

  it("skips invalid servers with redacted diagnostics", () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        "bad/name": {
          command: "npx"
        },
        mixed: {
          command: "npx",
          url: "https://mcp.example.com/mcp"
        },
        relativeCwd: {
          command: "node",
          cwd: "relative"
        },
        ftpServer: {
          url: "ftp://example.com/mcp"
        },
        typoServer: {
          command: "node",
          argumentz: ["server.js"]
        },
        secretServer: {
          command: "node",
          env: {
            API_KEY: "${MISSING_API_KEY}"
          }
        }
      }
    });

    const result = loadMcpServerDefinitions({ configPath, env: {} });

    expect(result.servers).toEqual({
      typoServer: {
        command: "node",
        argumentz: ["server.js"]
      }
    });
    expect(result.diagnostics.join("\n")).toContain("bad/name");
    expect(result.diagnostics.join("\n")).toContain("mixed");
    expect(result.diagnostics.join("\n")).toContain("relativeCwd");
    expect(result.diagnostics.join("\n")).toContain("ftpServer");
    expect(result.diagnostics.join("\n")).toContain("MISSING_API_KEY is not configured");
    expect(result.diagnostics.join("\n")).not.toContain("API_KEY=");
  });

  it("redacts bearer tokens, API keys, passwords, and secrets from diagnostics", () => {
    expect(
      redactMcpDiagnostic(
        "Authorization: Bearer real-token API_KEY=abc123 password=hunter2 secret=topsecret"
      )
    ).toBe("Authorization: Bearer [redacted] API_KEY=[redacted] password=[redacted] secret=[redacted]");
  });
});

describe("MCP runtime tool loading", () => {
  it("loads toolsets, namespaces tools by server, and uses a generic prompt summary", async () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/allowed"]
        },
        search: {
          url: "https://mcp.example.com/mcp"
        }
      }
    });
    const readFile = { id: "read_file", description: "Read an allowed file.", execute: async () => ({}) };
    const searchWeb = { id: "search_web", description: "Search public web results.", execute: async () => ({}) };
    const disconnect = vi.fn(async () => undefined);
    const createClient = vi.fn(() => ({
      disconnect,
      listToolsetsWithErrors: vi.fn(async () => ({
        errors: {},
        toolsets: {
          filesystem: { read_file: readFile },
          search: { search_web: searchWeb }
        }
      }))
    }));

    const result = await createMcpRuntimeTools({
      configPath,
      createClient,
      env: {}
    });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^tritree-mcp-/),
        servers: expect.objectContaining({
          filesystem: expect.objectContaining({ command: "npx" }),
          search: expect.objectContaining({ url: expect.any(URL) })
        })
      })
    );
    expect(Object.keys(result.tools)).toEqual(["filesystem_read_file", "search_search_web"]);
    expect(result.tools.filesystem_read_file).toMatchObject({
      description: expect.stringContaining(readFile.description),
      id: readFile.id
    });
    expect(result.tools.search_search_web).toMatchObject({
      description: expect.stringContaining(searchWeb.description),
      id: searchWeb.id
    });
    expect(result.toolSummaries.join("\n")).toContain("MCP runtime tools are available");
    expect(result.toolSummaries.join("\n")).not.toContain("filesystem_read_file");
    expect(result.toolSummaries.join("\n")).not.toContain("search_search_web");
    expect(result.tools.search_search_web).toMatchObject({
      description: expect.stringContaining("at most 5 times")
    });
    await result.disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("limits repeated MCP tool executions per runtime by default", async () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        search: {
          url: "https://mcp.example.com/mcp"
        }
      }
    });
    const lookup = { id: "lookup", description: "Lookup records.", execute: vi.fn(async () => ({ ok: true })) };
    const result = await createMcpRuntimeTools({
      configPath,
      createClient: () => ({
        disconnect: async () => undefined,
        listToolsetsWithErrors: async () => ({
          errors: {},
          toolsets: { search: { lookup } }
        })
      }),
      env: {}
    });

    const tool = result.tools.search_lookup as {
      execute: (input: Record<string, unknown>) => Promise<unknown>;
    };
    for (let index = 0; index < 5; index += 1) {
      await expect(tool.execute({ query: `item-${index}` })).resolves.toEqual({ ok: true });
    }

    await expect(tool.execute({ query: "item-5" })).resolves.toEqual({
      error: "MCP tool call limit reached for search_lookup after 5 calls; no external request was sent.",
      limit: 5,
      ok: false,
      toolName: "search_lookup"
    });
    expect(lookup.execute).toHaveBeenCalledTimes(5);
    expect(result.toolSummaries.join("\n")).toContain("Each MCP tool is limited to 5 executions per turn");
  });

  it("keeps non-English MCP labels and descriptions out of prompt summaries", async () => {
    const dir = makeTempDir();
    const hanLabel = String.fromCodePoint(0x6d4b, 0x8bd5);
    const hanDescription = String.fromCodePoint(0x63cf, 0x8ff0);
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        sampleServer: {
          command: "node",
          args: ["server.js"],
          label: hanLabel
        }
      }
    });
    const listRecords = { id: "listRecords", description: hanDescription, execute: async () => ({}) };
    const result = await createMcpRuntimeTools({
      configPath,
      createClient: () => ({
        disconnect: async () => undefined,
        listToolsetsWithErrors: async () => ({
          errors: {},
          toolsets: { sampleServer: { listRecords } }
        })
      }),
      env: {}
    });

    const summary = result.toolSummaries.join("\n");
    expect(summary).toContain("MCP runtime tools are available");
    expect(summary).not.toContain("sampleServer");
    expect(summary).not.toContain("sampleServer_listRecords");
    expect(summary).not.toContain("listRecords");
    expect(summary).not.toContain(hanLabel);
    expect(summary).not.toContain(hanDescription);
    expect(result.toolLabels.sampleServer_listRecords).toBe(hanLabel);
  });

  it("keeps existing tools when a namespaced MCP tool collides", async () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        filesystem: {
          command: "node",
          args: ["server.js"]
        }
      }
    });
    const localTool = { id: "filesystem_read_file", description: "Local tool", execute: async () => ({}) };
    const mcpTool = { id: "read_file", description: "MCP tool", execute: async () => ({}) };
    const result = await createMcpRuntimeTools({
      configPath,
      createClient: () => ({
        disconnect: async () => undefined,
        listToolsetsWithErrors: async () => ({
          errors: {},
          toolsets: { filesystem: { read_file: mcpTool } }
        })
      }),
      env: {},
      existingTools: { filesystem_read_file: localTool }
    });

    expect(result.tools).toEqual({});
    expect(result.toolSummaries.join("\n")).toContain("MCP tool skipped");
    expect(result.toolSummaries.join("\n")).not.toContain("filesystem_read_file");
  });

  it("reports per-server list errors without exposing configured secrets", async () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        search: {
          url: "https://mcp.example.com/mcp",
          requestInit: {
            headers: {
              Authorization: "Bearer ${REMOTE_SEARCH_MCP_TOKEN}"
            }
          }
        }
      }
    });
    const result = await createMcpRuntimeTools({
      configPath,
      createClient: () => ({
        disconnect: async () => undefined,
        listToolsetsWithErrors: async () => ({
          errors: { search: "Authorization: Bearer remote-secret failed" },
          toolsets: {}
        })
      }),
      env: { REMOTE_SEARCH_MCP_TOKEN: "remote-secret" }
    });

    expect(result.tools).toEqual({});
    expect(result.toolSummaries.join("\n")).toContain("MCP search unavailable");
    expect(result.toolSummaries.join("\n")).toContain("Bearer [redacted]");
    expect(result.toolSummaries.join("\n")).not.toContain("remote-secret");
  });

  it("returns no tools and reports cleanup failures when listing and disconnect both fail", async () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        search: {
          url: "https://mcp.example.com/mcp"
        }
      }
    });
    const log = vi.fn();
    const result = await createMcpRuntimeTools({
      configPath,
      createClient: () => ({
        disconnect: async () => {
          throw new Error("disconnect failed TOKEN=disconnect-secret");
        },
        listToolsetsWithErrors: async () => {
          throw new Error("Authorization: Bearer list-secret failed");
        }
      }),
      env: {},
      log
    });

    const summaries = result.toolSummaries.join("\n");
    expect(result.tools).toEqual({});
    expect(summaries).toContain("MCP tools unavailable");
    expect(summaries).toContain("Authorization: Bearer [redacted]");
    expect(summaries).toContain("MCP disconnect failed");
    expect(summaries).toContain("TOKEN=[redacted]");
    expect(summaries).not.toContain("list-secret");
    expect(summaries).not.toContain("disconnect-secret");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[tritree:mcp] MCP tools unavailable"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[tritree:mcp] MCP disconnect failed"));
  });

  it("keeps MCP tool descriptions out of prompt summaries", async () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        search: {
          url: "https://mcp.example.com/mcp"
        }
      }
    });
    const repeatedTail = "tail ".repeat(80);
    const lookup = {
      id: "lookup",
      description: `Lookup\n\nAuthorization: Bearer summary-secret with    extra whitespace ${repeatedTail}`,
      execute: async () => ({})
    };
    const result = await createMcpRuntimeTools({
      configPath,
      createClient: () => ({
        disconnect: async () => undefined,
        listToolsetsWithErrors: async () => ({
          errors: {},
          toolsets: { search: { lookup } }
        })
      }),
      env: {}
    });

    const summary = result.toolSummaries.join("\n");
    expect(summary).toContain("MCP runtime tools are available");
    expect(summary).not.toContain("lookup");
    expect(summary).not.toContain("Lookup");
    expect(summary).not.toContain("Authorization");
    expect(summary).not.toContain("Bearer");
    expect(summary).not.toContain("extra whitespace");
    expect(summary).not.toContain("...");
    expect(summary).not.toContain("\n\n");
    expect(summary).not.toContain("summary-secret");
    expect(summary).not.toContain(repeatedTail.trim());
  });

  it("falls back to listTools with the generic mcp namespace", async () => {
    const dir = makeTempDir();
    const configPath = writeJsonConfig(dir, {
      mcpServers: {
        local: {
          command: "node",
          args: ["server.js"]
        }
      }
    });
    const lookup = { id: "lookup", description: "Lookup records.", execute: async () => ({}) };
    const result = await createMcpRuntimeTools({
      configPath,
      createClient: () => ({
        disconnect: async () => undefined,
        listTools: async () => ({ lookup })
      }),
      env: {}
    });

    expect(Object.keys(result.tools)).toEqual(["mcp_lookup"]);
    expect(result.tools.mcp_lookup).toMatchObject({
      description: expect.stringContaining(lookup.description),
      id: lookup.id
    });
    expect(result.toolSummaries.join("\n")).toContain("MCP runtime tools are available");
    expect(result.toolSummaries.join("\n")).not.toContain("mcp_lookup");
  });

  it("returns no tools when config path is relative or config is invalid", async () => {
    const log = vi.fn();
    const result = await createMcpRuntimeTools({
      cwd: "/workspace/tritree",
      env: { TRITREE_MCP_CONFIG_PATH: "relative/mcp.json" },
      log
    });

    expect(result.tools).toEqual({});
    expect(result.toolSummaries.join("\n")).toContain("TRITREE_MCP_CONFIG_PATH must be an absolute path");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("TRITREE_MCP_CONFIG_PATH must be an absolute path"));
  });

  it("returns no tools when an explicit config path is relative", async () => {
    const log = vi.fn();
    const createClient = vi.fn();
    const result = await createMcpRuntimeTools({
      configPath: "relative/mcp.json",
      createClient,
      env: {},
      log
    });

    expect(result.tools).toEqual({});
    expect(result.toolSummaries.join("\n")).toContain("configPath must be an absolute path");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[tritree:mcp]"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("configPath must be an absolute path"));
    expect(createClient).not.toHaveBeenCalled();
  });
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, defaultDbPath, resolveDatabaseConfig } from "./client";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("defaultDbPath", () => {
  it("stores new Tritree data in .tritree by default", () => {
    delete process.env.TRITREE_DB_PATH;
    delete process.env.TREEABLE_DB_PATH;

    expect(defaultDbPath()).toMatch(/\.tritree\/tritree\.sqlite$/);
  });

  it("prefers TRITREE_DB_PATH and ignores legacy database path variables", () => {
    process.env.TRITREE_DB_PATH = "/tmp/new-tritree.sqlite";
    process.env.TREEABLE_DB_PATH = "/tmp/old-tritree.sqlite";

    expect(defaultDbPath()).toBe("/tmp/new-tritree.sqlite");

    delete process.env.TRITREE_DB_PATH;
    expect(defaultDbPath()).toMatch(/\.tritree\/tritree\.sqlite$/);
  });
});

describe("resolveDatabaseConfig", () => {
  it("uses sqlite by default", () => {
    delete process.env.TRITREE_DATABASE_URL;
    delete process.env.TRITREE_DB_DRIVER;
    delete process.env.TRITREE_DB_PATH;
    delete process.env.TREEABLE_DB_PATH;

    expect(resolveDatabaseConfig()).toEqual({ provider: "sqlite", path: defaultDbPath() });
  });

  it("uses mysql when TRITREE_DATABASE_URL is a mysql URL", () => {
    process.env.TRITREE_DATABASE_URL = "mysql://tritree:secret@localhost:3306/tritree";

    expect(resolveDatabaseConfig()).toEqual({
      provider: "mysql",
      url: "mysql://tritree:secret@localhost:3306/tritree"
    });
  });
});

describe("database schema", () => {
  it("creates artifact storage in the active sqlite schema", async () => {
    const db = await createDatabase({ provider: "sqlite", path: ":memory:" });
    const tables = await db.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    const names = tables.map((table) => table.name);

    expect(names).toContain("artifacts");

    const artifactColumns = await db.queryAll<{ name: string }>("PRAGMA table_info(artifacts)");
    expect(artifactColumns.map((column) => column.name)).toEqual([
      "id",
      "session_id",
      "node_id",
      "type",
      "version",
      "payload_json",
      "source_artifact_ids_json",
      "created_at",
      "updated_at"
    ]);

    const treeNodeColumns = await db.queryAll<{ name: string }>("PRAGMA table_info(tree_nodes)");
    expect(treeNodeColumns.map((column) => column.name)).toContain("updated_at");

    await db.close();
  });

  it("creates the schema through the mysql provider", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const queryText = (query: string | { sql: string }) => (typeof query === "string" ? query : query.sql);
    const pool = {
      query: vi.fn(async (query: string | { sql: string }, params: unknown[] = []) => {
        const sql = queryText(query);
        queries.push({ sql, params });
        if (sql.includes("information_schema.tables")) return [[{ name: "users" }], []];
        if (sql.includes("tritree_schema_version")) return [[{ version: 0 }], []];
        return [{ affectedRows: 0 }, []];
      }),
      end: vi.fn(async () => undefined)
    };

    const db = await createDatabase(
      { provider: "mysql", url: "mysql://tritree:secret@localhost:3306/tritree" },
      { createMysqlPool: () => pool as never }
    );

    expect(db.provider).toBe("mysql");
    expect(pool.query.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ sql: expect.any(String) }));
    expect(queries.map((query) => query.sql).join("\n")).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(queries.map((query) => query.sql).join("\n")).toContain("CREATE TABLE IF NOT EXISTS artifacts");
    expect(queries.map((query) => query.sql).join("\n")).toContain("information_schema.statistics");
    expect(queries.map((query) => query.sql).join("\n")).toContain("CREATE INDEX artifacts_session_type_idx");
    expect(queries.map((query) => query.sql).join("\n")).not.toContain("CREATE INDEX IF NOT EXISTS");

    await db.close();
    expect(pool.end).toHaveBeenCalled();
  });

  it("migrates legacy tree nodes without using a non-constant column default", async () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "tritree-client-")), "legacy.sqlite");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      PRAGMA user_version = 13;
      CREATE TABLE tree_nodes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_id TEXT,
        parent_option_id TEXT,
        kind TEXT NOT NULL DEFAULT 'decision',
        produced_artifact_id TEXT,
        source_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
        round_index INTEGER NOT NULL,
        round_intent TEXT NOT NULL,
        options_json TEXT NOT NULL,
        selected_option_id TEXT,
        folded_options_json TEXT NOT NULL,
        agent_messages_json TEXT NOT NULL DEFAULT '[]',
        is_terminal INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO tree_nodes (
        id,
        session_id,
        round_index,
        round_intent,
        options_json,
        folded_options_json,
        created_at
      )
      VALUES ('node-1', 'session-1', 1, '旧节点', '[]', '[]', '2026-05-18T00:00:00.000Z');
    `);
    legacy.close();

    const migrated = await createDatabase({ provider: "sqlite", path: dbPath });
    const row = await migrated.queryGet<{
      created_at: string;
      updated_at: string;
    }>("SELECT created_at, updated_at FROM tree_nodes WHERE id = 'node-1'");

    expect(row?.updated_at).toBe(row?.created_at);
    await migrated.close();
  });
});

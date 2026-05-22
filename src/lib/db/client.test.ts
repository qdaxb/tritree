import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, defaultDbPath } from "./client";

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

  it("prefers TRITREE_DB_PATH while keeping TREEABLE_DB_PATH as a legacy fallback", () => {
    process.env.TRITREE_DB_PATH = "/tmp/new-tritree.sqlite";
    process.env.TREEABLE_DB_PATH = "/tmp/old-treeable.sqlite";

    expect(defaultDbPath()).toBe("/tmp/new-tritree.sqlite");

    delete process.env.TRITREE_DB_PATH;
    expect(defaultDbPath()).toBe("/tmp/old-treeable.sqlite");
  });
});

describe("database schema", () => {
  it("creates artifact storage in the active schema", () => {
    const db = createDatabase(":memory:");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    const names = tables.map((table) => table.name);

    expect(names).toContain("artifacts");

    const artifactColumns = db.prepare("PRAGMA table_info(artifacts)").all() as Array<{ name: string }>;
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

    const treeNodeColumns = db.prepare("PRAGMA table_info(tree_nodes)").all() as Array<{ name: string }>;
    expect(treeNodeColumns.map((column) => column.name)).toContain("updated_at");

    db.close();
  });

  it("migrates legacy tree nodes without using a non-constant column default", () => {
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

    const migrated = createDatabase(dbPath);
    const row = migrated.prepare("SELECT created_at, updated_at FROM tree_nodes WHERE id = 'node-1'").get() as {
      created_at: string;
      updated_at: string;
    };

    expect(row.updated_at).toBe(row.created_at);
    migrated.close();
  });
});

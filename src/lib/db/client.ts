import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql as drizzleSql, type SQL, type SQLChunk } from "drizzle-orm";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzleSqliteProxy } from "drizzle-orm/sqlite-proxy";
import type { PoolOptions } from "mysql2";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import * as mysqlSchema from "./mysql-schema";
import * as sqliteSchema from "./schema";

const CURRENT_SCHEMA_VERSION = 14;
const CONTENT_RESET_SCHEMA_VERSION = 12;
const TRITREE_CONTENT_TABLES = [
  "artifacts",
  "branch_history",
  "tree_nodes",
  "session_enabled_skills",
  "sessions"
];
const TRITREE_TABLES = [
  ...TRITREE_CONTENT_TABLES,
  "creation_request_options",
  "skills",
  "user_oidc_identities",
  "users",
  "root_memory"
];

export type DatabaseConfig =
  | {
      provider: "sqlite";
      path: string;
    }
  | {
      provider: "mysql";
      url: string;
    };

export type QueryExecuteResult = {
  changes: number;
};

export interface TritreeDrizzleDatabase {
  provider: DatabaseConfig["provider"];
  queryAll<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]>;
  queryGet<T = unknown>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  execute(sql: string, ...params: unknown[]): Promise<QueryExecuteResult>;
  transaction<T>(write: (db: TritreeDrizzleDatabase) => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type MysqlPoolLike = Pick<Pool, "query" | "end"> & { getConnection?: Pool["getConnection"] };

type CreateDatabaseDependencies = {
  createMysqlPool?: (options: PoolOptions) => MysqlPoolLike;
};

type SqliteProxyMethod = "run" | "all" | "values" | "get";

type SqliteDrizzleExecutor = {
  all<T = unknown>(query: SQL): Promise<T[]>;
  get<T = unknown>(query: SQL): Promise<T | undefined>;
  run(query: SQL): Promise<unknown>;
  transaction<T>(transaction: (tx: SqliteDrizzleExecutor) => Promise<T>, config?: { behavior?: "deferred" | "immediate" | "exclusive" }): Promise<T>;
};

type MysqlDrizzleExecutor = {
  execute(query: SQL): Promise<unknown>;
  transaction<T>(transaction: (tx: MysqlDrizzleExecutor) => Promise<T>, config?: unknown): Promise<T>;
};

class UnsupportedDatabaseVersionError extends Error {
  constructor(version: number) {
    super(
      `Tritree database schema version ${version} is newer than this app supports. Back up your local database before changing app versions.`
    );
  }
}

export function defaultDbPath() {
  return process.env.TRITREE_DB_PATH ?? path.join(process.cwd(), ".tritree", "tritree.sqlite");
}

export function resolveDatabaseConfig(env = process.env): DatabaseConfig {
  const driver = env.TRITREE_DB_DRIVER?.trim().toLowerCase();
  const databaseUrl = env.TRITREE_DATABASE_URL?.trim();

  if (driver === "mysql" || databaseUrl?.startsWith("mysql://") || databaseUrl?.startsWith("mysql2://")) {
    if (!databaseUrl) {
      throw new Error("TRITREE_DATABASE_URL is required when TRITREE_DB_DRIVER=mysql.");
    }
    return { provider: "mysql", url: databaseUrl };
  }

  if (driver && driver !== "sqlite") {
    throw new Error(`Unsupported TRITREE_DB_DRIVER "${driver}". Expected "sqlite" or "mysql".`);
  }

  return { provider: "sqlite", path: env.TRITREE_DB_PATH ?? path.join(process.cwd(), ".tritree", "tritree.sqlite") };
}

export async function createDatabase(
  config: DatabaseConfig = resolveDatabaseConfig(),
  dependencies: CreateDatabaseDependencies = {}
): Promise<TritreeDrizzleDatabase> {
  if (config.provider === "mysql") {
    return createMysqlDatabase(config, dependencies);
  }
  return createSqliteDatabase(config.path);
}

async function createSqliteDatabase(dbPath: string): Promise<TritreeDrizzleDatabase> {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const sqlite = new DatabaseSync(dbPath);
  const orm = drizzleSqliteProxy(
    async (query, params, method) => executeSqliteProxy(sqlite, query, params, method) as Promise<{ rows: any[] }>,
    { schema: sqliteSchema }
  ) as SqliteDrizzleExecutor;
  const db = new SqliteTritreeDatabase(orm, sqlite);
  await db.execute("PRAGMA journal_mode = WAL");
  await db.execute("PRAGMA foreign_keys = ON");
  await migrateSqlite(db);
  return db;
}

async function createMysqlDatabase(
  config: Extract<DatabaseConfig, { provider: "mysql" }>,
  dependencies: CreateDatabaseDependencies
): Promise<TritreeDrizzleDatabase> {
  const createPool = dependencies.createMysqlPool ?? (await import("mysql2/promise")).createPool;
  const pool = createPool({
    uri: config.url,
    dateStrings: true,
    charset: "utf8mb4"
  });
  const orm = drizzleMysql(pool as Pool, { schema: mysqlSchema, mode: "default" }) as MysqlDrizzleExecutor;
  const db = new MysqlTritreeDatabase(orm, pool);
  await migrateMysql(db);
  return db;
}

class SqliteTritreeDatabase implements TritreeDrizzleDatabase {
  readonly provider = "sqlite" as const;

  constructor(
    private readonly orm: SqliteDrizzleExecutor,
    private readonly sqlite?: DatabaseSync
  ) {}

  async queryAll<T = unknown>(sql: string, ...params: unknown[]) {
    return this.orm.all<T>(toDrizzleSql(sql, params));
  }

  async queryGet<T = unknown>(sql: string, ...params: unknown[]) {
    return this.orm.get<T>(toDrizzleSql(sql, params));
  }

  async execute(sql: string, ...params: unknown[]) {
    const result = await this.orm.run(toDrizzleSql(sql, params));
    return { changes: sqliteChanges(result) };
  }

  async transaction<T>(write: (db: TritreeDrizzleDatabase) => T | Promise<T>): Promise<T> {
    return this.orm.transaction((tx) => Promise.resolve(write(new SqliteTritreeDatabase(tx))), { behavior: "immediate" });
  }

  async close() {
    this.sqlite?.close();
  }
}

class MysqlTritreeDatabase implements TritreeDrizzleDatabase {
  readonly provider = "mysql" as const;

  constructor(
    private readonly orm: MysqlDrizzleExecutor,
    private readonly pool?: MysqlPoolLike
  ) {}

  async queryAll<T = unknown>(sql: string, ...params: unknown[]) {
    const result = await this.orm.execute(toDrizzleSql(mysqlSql(sql), params));
    return mysqlRows(result) as T[];
  }

  async queryGet<T = unknown>(sql: string, ...params: unknown[]) {
    const rows = await this.queryAll<T>(sql, ...params);
    return rows[0];
  }

  async execute(sql: string, ...params: unknown[]) {
    const result = await this.orm.execute(toDrizzleSql(mysqlSql(sql), params));
    return { changes: mysqlAffectedRows(mysqlResultHeader(result)) };
  }

  async transaction<T>(write: (db: TritreeDrizzleDatabase) => T | Promise<T>): Promise<T> {
    return this.orm.transaction((tx) => Promise.resolve(write(new MysqlTritreeDatabase(tx))));
  }

  async close() {
    await this.pool?.end();
  }
}

async function executeSqliteProxy(sqlite: DatabaseSync, query: string, params: unknown[], method: SqliteProxyMethod) {
  const statement = sqlite.prepare(query);
  if (method === "run") {
    const result = statement.run(...(params as never[])) as { changes: number };
    return { rows: [{ changes: result.changes }] };
  }
  if (method === "get") {
    return { rows: statement.get(...(params as never[])) };
  }
  if (method === "values") {
    const rows = statement.all(...(params as never[])) as Record<string, unknown>[];
    return { rows: rows.map((row) => Object.values(row)) };
  }
  return { rows: statement.all(...(params as never[])) };
}

function toDrizzleSql(sqlText: string, params: unknown[]) {
  const parts = sqlText.split("?");
  if (parts.length - 1 !== params.length) {
    throw new Error(`SQL placeholder count does not match parameter count: ${sqlText}`);
  }

  const chunks: SQLChunk[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index]) chunks.push(drizzleSql.raw(parts[index]));
    if (index < params.length) chunks.push(drizzleSql.param(params[index]));
  }
  return chunks.length > 0 ? drizzleSql.join(chunks) : drizzleSql.empty();
}

function sqliteChanges(result: unknown) {
  if (result && typeof result === "object" && "rows" in result) {
    const [row] = (result as { rows?: Array<{ changes?: number }> }).rows ?? [];
    return Number(row?.changes ?? 0);
  }
  return 0;
}

function mysqlRows(result: unknown) {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0];
  }
  return [];
}

function mysqlResultHeader(result: unknown) {
  return Array.isArray(result) ? result[0] : result;
}

function mysqlAffectedRows(result: unknown) {
  if (result && typeof result === "object" && "affectedRows" in result) {
    return Number((result as ResultSetHeader).affectedRows ?? 0);
  }
  return 0;
}

function mysqlSql(sql: string) {
  return sql.replace(/\browid\b/gi, "id");
}

function splitSqlStatements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function executeBatch(db: TritreeDrizzleDatabase, sql: string) {
  for (const statement of splitSqlStatements(sql)) {
    await db.execute(statement);
  }
}

async function migrateSqlite(db: TritreeDrizzleDatabase) {
  const userVersion = (await db.queryGet<{ user_version: number }>("PRAGMA user_version")) ?? { user_version: 0 };
  if (userVersion.user_version > CURRENT_SCHEMA_VERSION && (await hasSqliteTritreeTables(db))) {
    throw new UnsupportedDatabaseVersionError(userVersion.user_version);
  }

  if (userVersion.user_version < CONTENT_RESET_SCHEMA_VERSION) {
    await resetSqliteContentTables(db);
  }

  await createSqliteSchema(db);
  await db.execute(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
}

async function hasSqliteTritreeTables(db: TritreeDrizzleDatabase) {
  for (const table of TRITREE_TABLES) {
    const row = await db.queryGet("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table);
    if (row) return true;
  }
  return false;
}

async function resetSqliteContentTables(db: TritreeDrizzleDatabase) {
  await db.execute("PRAGMA foreign_keys = OFF");
  for (const table of TRITREE_CONTENT_TABLES) {
    await db.execute(`DROP TABLE IF EXISTS ${table}`);
  }
  await db.execute("PRAGMA foreign_keys = ON");
}

async function createSqliteSchema(db: TritreeDrizzleDatabase) {
  await executeBatch(db, `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      is_active INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_oidc_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (issuer, subject)
    );

    CREATE TABLE IF NOT EXISTS root_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      preferences_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      learned_summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt TEXT NOT NULL,
      applies_to TEXT NOT NULL DEFAULT 'both',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL,
      default_enabled INTEGER NOT NULL,
      default_loaded INTEGER NOT NULL DEFAULT 1,
      parent_skill_id TEXT,
      is_archived INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS creation_request_options (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      is_archived INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      root_memory_id TEXT NOT NULL REFERENCES root_memory(id),
      artifact_type_id TEXT NOT NULL DEFAULT 'social-post',
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'finished')),
      current_node_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_enabled_skills (
      session_id TEXT NOT NULL REFERENCES sessions(id),
      skill_id TEXT NOT NULL REFERENCES skills(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS tree_nodes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      parent_id TEXT REFERENCES tree_nodes(id),
      parent_option_id TEXT,
      kind TEXT NOT NULL DEFAULT 'decision' CHECK (kind IN ('decision', 'artifact', 'analysis', 'action')),
      produced_artifact_id TEXT,
      source_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
      round_index INTEGER NOT NULL,
      round_intent TEXT NOT NULL,
      options_json TEXT NOT NULL,
      selected_option_id TEXT,
      folded_options_json TEXT NOT NULL,
      agent_messages_json TEXT NOT NULL DEFAULT '[]',
      is_terminal INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      node_id TEXT NOT NULL REFERENCES tree_nodes(id),
      type TEXT NOT NULL,
      version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      source_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS branch_history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      node_id TEXT NOT NULL REFERENCES tree_nodes(id),
      option_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await addSqliteColumnIfMissing(db, "tree_nodes", "parent_option_id", "TEXT");
  await addSqliteColumnIfMissing(db, "tree_nodes", "kind", "TEXT NOT NULL DEFAULT 'decision'");
  await addSqliteColumnIfMissing(db, "tree_nodes", "produced_artifact_id", "TEXT");
  await addSqliteColumnIfMissing(db, "tree_nodes", "source_artifact_ids_json", "TEXT NOT NULL DEFAULT '[]'");
  await addSqliteColumnIfMissing(db, "tree_nodes", "is_terminal", "INTEGER NOT NULL DEFAULT 0");
  await addSqliteColumnIfMissing(db, "tree_nodes", "agent_messages_json", "TEXT NOT NULL DEFAULT '[]'");
  const addedTreeNodeUpdatedAt = await addSqliteColumnIfMissing(db, "tree_nodes", "updated_at", "TEXT");
  if (addedTreeNodeUpdatedAt) {
    await db.execute("UPDATE tree_nodes SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''");
  }
  await addSqliteColumnIfMissing(db, "skills", "applies_to", "TEXT NOT NULL DEFAULT 'both'");
  await addSqliteColumnIfMissing(db, "skills", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  await addSqliteColumnIfMissing(db, "skills", "default_loaded", "INTEGER NOT NULL DEFAULT 1");
  await addSqliteColumnIfMissing(db, "skills", "parent_skill_id", "TEXT");
  await addSqliteColumnIfMissing(db, "root_memory", "user_id", "TEXT REFERENCES users(id)");
  await addSqliteColumnIfMissing(db, "sessions", "user_id", "TEXT REFERENCES users(id)");
  await addSqliteColumnIfMissing(db, "sessions", "is_archived", "INTEGER NOT NULL DEFAULT 0");
  await addSqliteColumnIfMissing(db, "sessions", "artifact_type_id", "TEXT NOT NULL DEFAULT 'social-post'");
  await addSqliteColumnIfMissing(db, "skills", "user_id", "TEXT REFERENCES users(id)");
  await addSqliteColumnIfMissing(db, "creation_request_options", "user_id", "TEXT REFERENCES users(id)");
  await db.execute("DROP INDEX IF EXISTS root_memory_user_id_unique");
  await db.execute("CREATE INDEX IF NOT EXISTS root_memory_user_updated_idx ON root_memory(user_id, updated_at, created_at)");
  await db.execute("CREATE INDEX IF NOT EXISTS sessions_user_updated_idx ON sessions(user_id, updated_at, created_at)");
  await db.execute("CREATE INDEX IF NOT EXISTS sessions_user_archived_updated_idx ON sessions(user_id, is_archived, updated_at, created_at)");
  await db.execute("CREATE INDEX IF NOT EXISTS skills_user_archived_idx ON skills(user_id, is_archived)");
  await db.execute("CREATE INDEX IF NOT EXISTS creation_request_options_user_sort_idx ON creation_request_options(user_id, sort_order)");
  await db.execute("CREATE INDEX IF NOT EXISTS artifacts_session_node_idx ON artifacts(session_id, node_id, updated_at, created_at)");
  await db.execute("CREATE INDEX IF NOT EXISTS artifacts_session_type_idx ON artifacts(session_id, type, updated_at, created_at)");
}

async function addSqliteColumnIfMissing(db: TritreeDrizzleDatabase, tableName: string, columnName: string, definition: string) {
  const columns = await db.queryAll<{ name: string }>(`PRAGMA table_info(${tableName})`);
  if (columns.some((column) => column.name === columnName)) return false;
  await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  return true;
}

async function migrateMysql(db: TritreeDrizzleDatabase) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tritree_schema_version (
      id INT NOT NULL PRIMARY KEY,
      version INT NOT NULL,
      updated_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const versionRow = await db.queryGet<{ version: number | string }>("SELECT version FROM tritree_schema_version WHERE id = 1");
  const version = Number(versionRow?.version ?? 0);
  if (version > CURRENT_SCHEMA_VERSION && (await hasMysqlTritreeTables(db))) {
    throw new UnsupportedDatabaseVersionError(version);
  }

  await createMysqlSchema(db);
  await db.execute(
    `
      INSERT INTO tritree_schema_version (id, version, updated_at)
      VALUES (1, ?, ?)
      ON DUPLICATE KEY UPDATE version = VALUES(version), updated_at = VALUES(updated_at)
    `,
    CURRENT_SCHEMA_VERSION,
    new Date().toISOString()
  );
}

async function hasMysqlTritreeTables(db: TritreeDrizzleDatabase) {
  const placeholders = TRITREE_TABLES.map(() => "?").join(", ");
  const rows = await db.queryAll<RowDataPacket & { name: string }>(
    `
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${placeholders})
    `,
    ...TRITREE_TABLES
  );
  return rows.length > 0;
}

async function createMysqlSchema(db: TritreeDrizzleDatabase) {
  const tableOptions = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      username VARCHAR(191) NOT NULL,
      display_name VARCHAR(255) NOT NULL,
      password_hash TEXT,
      role VARCHAR(32) NOT NULL,
      is_active TINYINT NOT NULL,
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      UNIQUE KEY users_username_unique (username),
      CHECK (role IN ('admin', 'member'))
    ) ${tableOptions}
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_oidc_identities (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      issuer VARCHAR(255) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL DEFAULT '',
      name VARCHAR(255) NOT NULL DEFAULT '',
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      UNIQUE KEY user_oidc_identities_issuer_subject_unique (issuer, subject),
      KEY user_oidc_identities_user_idx (user_id),
      CONSTRAINT user_oidc_identities_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
    ) ${tableOptions}
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS root_memory (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      user_id VARCHAR(191),
      preferences_json LONGTEXT NOT NULL,
      summary TEXT NOT NULL,
      learned_summary TEXT NOT NULL,
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      KEY root_memory_user_fk_idx (user_id),
      CONSTRAINT root_memory_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
    ) ${tableOptions}
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS skills (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      user_id VARCHAR(191),
      title VARCHAR(255) NOT NULL,
      category VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      prompt LONGTEXT NOT NULL,
      applies_to VARCHAR(32) NOT NULL DEFAULT 'both',
      sort_order INT NOT NULL DEFAULT 0,
      is_system TINYINT NOT NULL,
      default_enabled TINYINT NOT NULL,
      default_loaded TINYINT NOT NULL DEFAULT 1,
      parent_skill_id VARCHAR(191),
      is_archived TINYINT NOT NULL,
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      KEY skills_user_fk_idx (user_id),
      CONSTRAINT skills_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
    ) ${tableOptions}
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS creation_request_options (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      user_id VARCHAR(191),
      label VARCHAR(255) NOT NULL,
      sort_order INT NOT NULL,
      is_archived TINYINT NOT NULL,
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      KEY creation_request_options_user_fk_idx (user_id),
      CONSTRAINT creation_request_options_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
    ) ${tableOptions}
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      user_id VARCHAR(191),
      root_memory_id VARCHAR(191) NOT NULL,
      artifact_type_id VARCHAR(191) NOT NULL DEFAULT 'social-post',
      title VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL,
      current_node_id VARCHAR(191),
      is_archived TINYINT NOT NULL DEFAULT 0,
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      KEY sessions_user_fk_idx (user_id),
      KEY sessions_root_memory_fk_idx (root_memory_id),
      CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id),
      CONSTRAINT sessions_root_memory_fk FOREIGN KEY (root_memory_id) REFERENCES root_memory(id),
      CHECK (status IN ('active', 'finished'))
    ) ${tableOptions}
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS session_enabled_skills (
      session_id VARCHAR(191) NOT NULL,
      skill_id VARCHAR(191) NOT NULL,
      created_at VARCHAR(64) NOT NULL,
      PRIMARY KEY (session_id, skill_id),
      KEY session_enabled_skills_skill_fk_idx (skill_id),
      CONSTRAINT session_enabled_skills_session_fk FOREIGN KEY (session_id) REFERENCES sessions(id),
      CONSTRAINT session_enabled_skills_skill_fk FOREIGN KEY (skill_id) REFERENCES skills(id)
    ) ${tableOptions}
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tree_nodes (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      session_id VARCHAR(191) NOT NULL,
      parent_id VARCHAR(191),
      parent_option_id VARCHAR(191),
      kind VARCHAR(32) NOT NULL DEFAULT 'decision',
      produced_artifact_id VARCHAR(191),
      source_artifact_ids_json LONGTEXT NOT NULL,
      round_index INT NOT NULL,
      round_intent TEXT NOT NULL,
      options_json LONGTEXT NOT NULL,
      selected_option_id VARCHAR(191),
      folded_options_json LONGTEXT NOT NULL,
      agent_messages_json LONGTEXT NOT NULL,
      is_terminal TINYINT NOT NULL DEFAULT 0,
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      KEY tree_nodes_session_fk_idx (session_id),
      KEY tree_nodes_parent_fk_idx (parent_id),
      CONSTRAINT tree_nodes_session_fk FOREIGN KEY (session_id) REFERENCES sessions(id),
      CONSTRAINT tree_nodes_parent_fk FOREIGN KEY (parent_id) REFERENCES tree_nodes(id),
      CHECK (kind IN ('decision', 'artifact', 'analysis', 'action'))
    ) ${tableOptions}
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      session_id VARCHAR(191) NOT NULL,
      node_id VARCHAR(191) NOT NULL,
      type VARCHAR(191) NOT NULL,
      version INT NOT NULL,
      payload_json LONGTEXT NOT NULL,
      source_artifact_ids_json LONGTEXT NOT NULL,
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      KEY artifacts_session_fk_idx (session_id),
      KEY artifacts_node_fk_idx (node_id),
      CONSTRAINT artifacts_session_fk FOREIGN KEY (session_id) REFERENCES sessions(id),
      CONSTRAINT artifacts_node_fk FOREIGN KEY (node_id) REFERENCES tree_nodes(id)
    ) ${tableOptions}
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS branch_history (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      session_id VARCHAR(191) NOT NULL,
      node_id VARCHAR(191) NOT NULL,
      option_json LONGTEXT NOT NULL,
      created_at VARCHAR(64) NOT NULL,
      KEY branch_history_session_fk_idx (session_id),
      KEY branch_history_node_fk_idx (node_id),
      CONSTRAINT branch_history_session_fk FOREIGN KEY (session_id) REFERENCES sessions(id),
      CONSTRAINT branch_history_node_fk FOREIGN KEY (node_id) REFERENCES tree_nodes(id)
    ) ${tableOptions}
  `);

  await addMysqlColumnIfMissing(db, "tree_nodes", "parent_option_id", "VARCHAR(191)");
  await addMysqlColumnIfMissing(db, "tree_nodes", "kind", "VARCHAR(32) NOT NULL DEFAULT 'decision'");
  await addMysqlColumnIfMissing(db, "tree_nodes", "produced_artifact_id", "VARCHAR(191)");
  await addMysqlColumnIfMissing(db, "tree_nodes", "source_artifact_ids_json", "LONGTEXT NOT NULL");
  await addMysqlColumnIfMissing(db, "tree_nodes", "is_terminal", "TINYINT NOT NULL DEFAULT 0");
  await addMysqlColumnIfMissing(db, "tree_nodes", "agent_messages_json", "LONGTEXT NOT NULL");
  await addMysqlColumnIfMissing(db, "tree_nodes", "updated_at", "VARCHAR(64) NOT NULL");
  await addMysqlColumnIfMissing(db, "skills", "applies_to", "VARCHAR(32) NOT NULL DEFAULT 'both'");
  await addMysqlColumnIfMissing(db, "skills", "sort_order", "INT NOT NULL DEFAULT 0");
  await addMysqlColumnIfMissing(db, "skills", "default_loaded", "TINYINT NOT NULL DEFAULT 1");
  await addMysqlColumnIfMissing(db, "skills", "parent_skill_id", "VARCHAR(191)");
  await addMysqlColumnIfMissing(db, "root_memory", "user_id", "VARCHAR(191)");
  await addMysqlColumnIfMissing(db, "sessions", "user_id", "VARCHAR(191)");
  await addMysqlColumnIfMissing(db, "sessions", "is_archived", "TINYINT NOT NULL DEFAULT 0");
  await addMysqlColumnIfMissing(db, "sessions", "artifact_type_id", "VARCHAR(191) NOT NULL DEFAULT 'social-post'");
  await addMysqlColumnIfMissing(db, "skills", "user_id", "VARCHAR(191)");
  await addMysqlColumnIfMissing(db, "creation_request_options", "user_id", "VARCHAR(191)");

  await addMysqlIndexIfMissing(
    db,
    "root_memory",
    "root_memory_user_updated_idx",
    "CREATE INDEX root_memory_user_updated_idx ON root_memory(user_id, updated_at, created_at)"
  );
  await addMysqlIndexIfMissing(
    db,
    "sessions",
    "sessions_user_updated_idx",
    "CREATE INDEX sessions_user_updated_idx ON sessions(user_id, updated_at, created_at)"
  );
  await addMysqlIndexIfMissing(
    db,
    "sessions",
    "sessions_user_archived_updated_idx",
    "CREATE INDEX sessions_user_archived_updated_idx ON sessions(user_id, is_archived, updated_at, created_at)"
  );
  await addMysqlIndexIfMissing(
    db,
    "skills",
    "skills_user_archived_idx",
    "CREATE INDEX skills_user_archived_idx ON skills(user_id, is_archived)"
  );
  await addMysqlIndexIfMissing(
    db,
    "creation_request_options",
    "creation_request_options_user_sort_idx",
    "CREATE INDEX creation_request_options_user_sort_idx ON creation_request_options(user_id, sort_order)"
  );
  await addMysqlIndexIfMissing(
    db,
    "artifacts",
    "artifacts_session_node_idx",
    "CREATE INDEX artifacts_session_node_idx ON artifacts(session_id, node_id, updated_at, created_at)"
  );
  await addMysqlIndexIfMissing(
    db,
    "artifacts",
    "artifacts_session_type_idx",
    "CREATE INDEX artifacts_session_type_idx ON artifacts(session_id, type, updated_at, created_at)"
  );
}

async function addMysqlColumnIfMissing(db: TritreeDrizzleDatabase, tableName: string, columnName: string, definition: string) {
  const column = await db.queryGet<{ name: string }>(
    `
      SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    tableName,
    columnName
  );
  if (column) return false;
  await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  return true;
}

async function addMysqlIndexIfMissing(db: TritreeDrizzleDatabase, tableName: string, indexName: string, createSql: string) {
  const index = await db.queryGet<{ name: string }>(
    `
      SELECT index_name AS name
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1
    `,
    tableName,
    indexName
  );
  if (index) return false;
  await db.execute(createSql);
  return true;
}

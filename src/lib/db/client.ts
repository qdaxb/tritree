import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const CURRENT_SCHEMA_VERSION = 7;
const TREEABLE_TABLES = [
  "publish_packages",
  "branch_history",
  "draft_versions",
  "tree_nodes",
  "session_enabled_skills",
  "sessions",
  "creation_request_options",
  "skills",
  "user_oidc_identities",
  "users",
  "root_memory"
];

class UnsupportedDatabaseVersionError extends Error {
  constructor(version: number) {
    super(
      `Treeable database schema version ${version} is newer than this app supports. Back up your local database before changing app versions.`
    );
  }
}

export function defaultDbPath() {
  return process.env.TREEABLE_DB_PATH ?? path.join(process.cwd(), ".treeable", "treeable.sqlite");
}

export function createDatabase(dbPath = defaultDbPath()) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  migrate(sqlite);
  return sqlite;
}

function migrate(sqlite: DatabaseSync) {
  const userVersion = sqlite.prepare("PRAGMA user_version;").get() as { user_version: number };
  if (userVersion.user_version > CURRENT_SCHEMA_VERSION && hasTreeableTables(sqlite)) {
    throw new UnsupportedDatabaseVersionError(userVersion.user_version);
  }

  createSchema(sqlite);
  sqlite.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
}

function hasTreeableTables(sqlite: DatabaseSync) {
  return TREEABLE_TABLES.some((table) => {
    const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    return Boolean(row);
  });
}

function createSchema(sqlite: DatabaseSync) {
  sqlite.exec(`
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
      is_system INTEGER NOT NULL,
      default_enabled INTEGER NOT NULL,
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
      round_index INTEGER NOT NULL,
      round_intent TEXT NOT NULL,
      options_json TEXT NOT NULL,
      selected_option_id TEXT,
      folded_options_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS draft_versions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      node_id TEXT NOT NULL REFERENCES tree_nodes(id),
      round_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      hashtags_json TEXT NOT NULL,
      image_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS branch_history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      node_id TEXT NOT NULL REFERENCES tree_nodes(id),
      option_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS publish_packages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
      node_id TEXT NOT NULL REFERENCES tree_nodes(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      hashtags_json TEXT NOT NULL,
      image_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  addColumnIfMissing(sqlite, "tree_nodes", "parent_option_id", "TEXT");
  addColumnIfMissing(sqlite, "skills", "applies_to", "TEXT NOT NULL DEFAULT 'both'");
  addColumnIfMissing(sqlite, "root_memory", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(sqlite, "sessions", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(sqlite, "sessions", "is_archived", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "skills", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(sqlite, "creation_request_options", "user_id", "TEXT REFERENCES users(id)");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS root_memory_user_id_unique ON root_memory(user_id) WHERE user_id IS NOT NULL;");
  sqlite.exec("CREATE INDEX IF NOT EXISTS sessions_user_updated_idx ON sessions(user_id, updated_at, created_at);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS sessions_user_archived_updated_idx ON sessions(user_id, is_archived, updated_at, created_at);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS skills_user_archived_idx ON skills(user_id, is_archived);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS creation_request_options_user_sort_idx ON creation_request_options(user_id, sort_order);");
}

function addColumnIfMissing(sqlite: DatabaseSync, tableName: string, columnName: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName});`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return;
  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
}

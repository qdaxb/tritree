import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const CURRENT_SCHEMA_VERSION = 14;
const CONTENT_RESET_SCHEMA_VERSION = 12;
const TREEABLE_CONTENT_TABLES = [
  "artifacts",
  "branch_history",
  "tree_nodes",
  "session_enabled_skills",
  "sessions"
];
const TREEABLE_TABLES = [
  ...TREEABLE_CONTENT_TABLES,
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
  return process.env.TRITREE_DB_PATH ?? process.env.TREEABLE_DB_PATH ?? path.join(process.cwd(), ".tritree", "tritree.sqlite");
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

  if (userVersion.user_version < CONTENT_RESET_SCHEMA_VERSION) {
    resetContentTables(sqlite);
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

function resetContentTables(sqlite: DatabaseSync) {
  sqlite.exec("PRAGMA foreign_keys = OFF;");
  for (const table of TREEABLE_CONTENT_TABLES) {
    sqlite.exec(`DROP TABLE IF EXISTS ${table};`);
  }
  sqlite.exec("PRAGMA foreign_keys = ON;");
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
  addColumnIfMissing(sqlite, "tree_nodes", "parent_option_id", "TEXT");
  addColumnIfMissing(sqlite, "tree_nodes", "kind", "TEXT NOT NULL DEFAULT 'decision'");
  addColumnIfMissing(sqlite, "tree_nodes", "produced_artifact_id", "TEXT");
  addColumnIfMissing(sqlite, "tree_nodes", "source_artifact_ids_json", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(sqlite, "tree_nodes", "is_terminal", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "tree_nodes", "agent_messages_json", "TEXT NOT NULL DEFAULT '[]'");
  const addedTreeNodeUpdatedAt = addColumnIfMissing(sqlite, "tree_nodes", "updated_at", "TEXT");
  if (addedTreeNodeUpdatedAt) {
    sqlite.exec("UPDATE tree_nodes SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = '';");
  }
  addColumnIfMissing(sqlite, "skills", "applies_to", "TEXT NOT NULL DEFAULT 'both'");
  addColumnIfMissing(sqlite, "skills", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "skills", "default_loaded", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(sqlite, "skills", "parent_skill_id", "TEXT");
  addColumnIfMissing(sqlite, "root_memory", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(sqlite, "sessions", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(sqlite, "sessions", "is_archived", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "sessions", "artifact_type_id", "TEXT NOT NULL DEFAULT 'social-post'");
  addColumnIfMissing(sqlite, "skills", "user_id", "TEXT REFERENCES users(id)");
  addColumnIfMissing(sqlite, "creation_request_options", "user_id", "TEXT REFERENCES users(id)");
  sqlite.exec("DROP INDEX IF EXISTS root_memory_user_id_unique;");
  sqlite.exec("CREATE INDEX IF NOT EXISTS root_memory_user_updated_idx ON root_memory(user_id, updated_at, created_at);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS sessions_user_updated_idx ON sessions(user_id, updated_at, created_at);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS sessions_user_archived_updated_idx ON sessions(user_id, is_archived, updated_at, created_at);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS skills_user_archived_idx ON skills(user_id, is_archived);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS creation_request_options_user_sort_idx ON creation_request_options(user_id, sort_order);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS artifacts_session_node_idx ON artifacts(session_id, node_id, updated_at, created_at);");
  sqlite.exec("CREATE INDEX IF NOT EXISTS artifacts_session_type_idx ON artifacts(session_id, type, updated_at, created_at);");
}

function addColumnIfMissing(sqlite: DatabaseSync, tableName: string, columnName: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName});`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return false;
  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  return true;
}

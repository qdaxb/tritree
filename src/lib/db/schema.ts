import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// SQLite Drizzle schema used by the runtime database client.
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash"),
    role: text("role").notNull(),
    isActive: integer("is_active").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [check("users_role_check", sql`${table.role} IN ('admin', 'member')`)]
);

export const userOidcIdentities = sqliteTable(
  "user_oidc_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    email: text("email").notNull().default(""),
    name: text("name").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [unique("user_oidc_identities_issuer_subject_unique").on(table.issuer, table.subject)]
);

export const rootMemory = sqliteTable("root_memory", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  preferencesJson: text("preferences_json").notNull(),
  summary: text("summary").notNull(),
  learnedSummary: text("learned_summary").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  prompt: text("prompt").notNull(),
  appliesTo: text("applies_to").notNull().default("both"),
  isSystem: integer("is_system").notNull(),
  defaultEnabled: integer("default_enabled").notNull(),
  defaultLoaded: integer("default_loaded").notNull().default(1),
  parentSkillId: text("parent_skill_id"),
  isArchived: integer("is_archived").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const creationRequestOptions = sqliteTable("creation_request_options", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
  isArchived: integer("is_archived").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    rootMemoryId: text("root_memory_id")
      .notNull()
      .references(() => rootMemory.id),
    artifactTypeId: text("artifact_type_id").notNull().default("social-post"),
    title: text("title").notNull(),
    status: text("status").notNull(),
    currentNodeId: text("current_node_id"),
    isArchived: integer("is_archived").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [check("sessions_status_check", sql`${table.status} IN ('active', 'finished')`)]
);

export const sessionEnabledSkills = sqliteTable(
  "session_enabled_skills",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.skillId] })]
);

export const treeNodes = sqliteTable("tree_nodes", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  parentId: text("parent_id").references((): AnySQLiteColumn => treeNodes.id),
  parentOptionId: text("parent_option_id"),
  kind: text("kind").notNull().default("decision"),
  producedArtifactId: text("produced_artifact_id"),
  sourceArtifactIdsJson: text("source_artifact_ids_json").notNull().default("[]"),
  roundIndex: integer("round_index").notNull(),
  roundIntent: text("round_intent").notNull(),
  optionsJson: text("options_json").notNull(),
  selectedOptionId: text("selected_option_id"),
  foldedOptionsJson: text("folded_options_json").notNull(),
  agentMessagesJson: text("agent_messages_json").notNull().default("[]"),
  isTerminal: integer("is_terminal").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  nodeId: text("node_id")
    .notNull()
    .references(() => treeNodes.id),
  type: text("type").notNull(),
  version: integer("version").notNull(),
  payloadJson: text("payload_json").notNull(),
  sourceArtifactIdsJson: text("source_artifact_ids_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const branchHistory = sqliteTable("branch_history", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  nodeId: text("node_id")
    .notNull()
    .references(() => treeNodes.id),
  optionJson: text("option_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

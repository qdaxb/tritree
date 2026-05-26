import { sql } from "drizzle-orm";
import { check, index, int, longtext, mysqlTable, primaryKey, text, tinyint, unique, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    username: varchar("username", { length: 191 }).notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    passwordHash: text("password_hash"),
    role: varchar("role", { length: 32 }).notNull(),
    isActive: tinyint("is_active").notNull(),
    createdAt: varchar("created_at", { length: 64 }).notNull(),
    updatedAt: varchar("updated_at", { length: 64 }).notNull()
  },
  (table) => [unique("users_username_unique").on(table.username), check("users_role_check", sql`${table.role} IN ('admin', 'member')`)]
);

export const userOidcIdentities = mysqlTable(
  "user_oidc_identities",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id),
    issuer: varchar("issuer", { length: 255 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().default(""),
    name: varchar("name", { length: 255 }).notNull().default(""),
    createdAt: varchar("created_at", { length: 64 }).notNull(),
    updatedAt: varchar("updated_at", { length: 64 }).notNull()
  },
  (table) => [
    unique("user_oidc_identities_issuer_subject_unique").on(table.issuer, table.subject),
    index("user_oidc_identities_user_idx").on(table.userId)
  ]
);

export const rootMemory = mysqlTable(
  "root_memory",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("user_id", { length: 191 }).references(() => users.id),
    preferencesJson: longtext("preferences_json").notNull(),
    summary: text("summary").notNull(),
    learnedSummary: text("learned_summary").notNull(),
    createdAt: varchar("created_at", { length: 64 }).notNull(),
    updatedAt: varchar("updated_at", { length: 64 }).notNull()
  },
  (table) => [index("root_memory_user_fk_idx").on(table.userId), index("root_memory_user_updated_idx").on(table.userId, table.updatedAt, table.createdAt)]
);

export const skills = mysqlTable(
  "skills",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("user_id", { length: 191 }).references(() => users.id),
    title: varchar("title", { length: 255 }).notNull(),
    category: varchar("category", { length: 255 }).notNull(),
    description: text("description").notNull(),
    prompt: longtext("prompt").notNull(),
    appliesTo: varchar("applies_to", { length: 32 }).notNull().default("both"),
    sortOrder: int("sort_order").notNull().default(0),
    isSystem: tinyint("is_system").notNull(),
    defaultEnabled: tinyint("default_enabled").notNull(),
    defaultLoaded: tinyint("default_loaded").notNull().default(1),
    parentSkillId: varchar("parent_skill_id", { length: 191 }),
    isArchived: tinyint("is_archived").notNull(),
    createdAt: varchar("created_at", { length: 64 }).notNull(),
    updatedAt: varchar("updated_at", { length: 64 }).notNull()
  },
  (table) => [index("skills_user_fk_idx").on(table.userId), index("skills_user_archived_idx").on(table.userId, table.isArchived)]
);

export const creationRequestOptions = mysqlTable(
  "creation_request_options",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("user_id", { length: 191 }).references(() => users.id),
    label: varchar("label", { length: 255 }).notNull(),
    sortOrder: int("sort_order").notNull(),
    isArchived: tinyint("is_archived").notNull(),
    createdAt: varchar("created_at", { length: 64 }).notNull(),
    updatedAt: varchar("updated_at", { length: 64 }).notNull()
  },
  (table) => [
    index("creation_request_options_user_fk_idx").on(table.userId),
    index("creation_request_options_user_sort_idx").on(table.userId, table.sortOrder)
  ]
);

export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("user_id", { length: 191 }).references(() => users.id),
    rootMemoryId: varchar("root_memory_id", { length: 191 })
      .notNull()
      .references(() => rootMemory.id),
    artifactTypeId: varchar("artifact_type_id", { length: 191 }).notNull().default("social-post"),
    title: varchar("title", { length: 255 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    currentNodeId: varchar("current_node_id", { length: 191 }),
    isArchived: tinyint("is_archived").notNull().default(0),
    createdAt: varchar("created_at", { length: 64 }).notNull(),
    updatedAt: varchar("updated_at", { length: 64 }).notNull()
  },
  (table) => [
    index("sessions_user_fk_idx").on(table.userId),
    index("sessions_root_memory_fk_idx").on(table.rootMemoryId),
    index("sessions_user_updated_idx").on(table.userId, table.updatedAt, table.createdAt),
    index("sessions_user_archived_updated_idx").on(table.userId, table.isArchived, table.updatedAt, table.createdAt),
    check("sessions_status_check", sql`${table.status} IN ('active', 'finished')`)
  ]
);

export const sessionEnabledSkills = mysqlTable(
  "session_enabled_skills",
  {
    sessionId: varchar("session_id", { length: 191 })
      .notNull()
      .references(() => sessions.id),
    skillId: varchar("skill_id", { length: 191 })
      .notNull()
      .references(() => skills.id),
    createdAt: varchar("created_at", { length: 64 }).notNull()
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.skillId] }), index("session_enabled_skills_skill_fk_idx").on(table.skillId)]
);

export const treeNodes = mysqlTable(
  "tree_nodes",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    sessionId: varchar("session_id", { length: 191 })
      .notNull()
      .references(() => sessions.id),
    parentId: varchar("parent_id", { length: 191 }),
    parentOptionId: varchar("parent_option_id", { length: 191 }),
    kind: varchar("kind", { length: 32 }).notNull().default("decision"),
    producedArtifactId: varchar("produced_artifact_id", { length: 191 }),
    sourceArtifactIdsJson: longtext("source_artifact_ids_json").notNull(),
    roundIndex: int("round_index").notNull(),
    roundIntent: text("round_intent").notNull(),
    optionsJson: longtext("options_json").notNull(),
    selectedOptionId: varchar("selected_option_id", { length: 191 }),
    foldedOptionsJson: longtext("folded_options_json").notNull(),
    agentMessagesJson: longtext("agent_messages_json").notNull(),
    isTerminal: tinyint("is_terminal").notNull().default(0),
    createdAt: varchar("created_at", { length: 64 }).notNull(),
    updatedAt: varchar("updated_at", { length: 64 }).notNull()
  },
  (table) => [
    index("tree_nodes_session_fk_idx").on(table.sessionId),
    index("tree_nodes_parent_fk_idx").on(table.parentId),
    check("tree_nodes_kind_check", sql`${table.kind} IN ('decision', 'artifact', 'analysis', 'action')`)
  ]
);

export const artifacts = mysqlTable(
  "artifacts",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    sessionId: varchar("session_id", { length: 191 })
      .notNull()
      .references(() => sessions.id),
    nodeId: varchar("node_id", { length: 191 })
      .notNull()
      .references(() => treeNodes.id),
    type: varchar("type", { length: 191 }).notNull(),
    version: int("version").notNull(),
    payloadJson: longtext("payload_json").notNull(),
    sourceArtifactIdsJson: longtext("source_artifact_ids_json").notNull(),
    createdAt: varchar("created_at", { length: 64 }).notNull(),
    updatedAt: varchar("updated_at", { length: 64 }).notNull()
  },
  (table) => [
    index("artifacts_session_fk_idx").on(table.sessionId),
    index("artifacts_node_fk_idx").on(table.nodeId),
    index("artifacts_session_node_idx").on(table.sessionId, table.nodeId, table.updatedAt, table.createdAt),
    index("artifacts_session_type_idx").on(table.sessionId, table.type, table.updatedAt, table.createdAt)
  ]
);

export const branchHistory = mysqlTable(
  "branch_history",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    sessionId: varchar("session_id", { length: 191 })
      .notNull()
      .references(() => sessions.id),
    nodeId: varchar("node_id", { length: 191 })
      .notNull()
      .references(() => treeNodes.id),
    optionJson: longtext("option_json").notNull(),
    createdAt: varchar("created_at", { length: 64 }).notNull()
  },
  (table) => [index("branch_history_session_fk_idx").on(table.sessionId), index("branch_history_node_fk_idx").on(table.nodeId)]
);

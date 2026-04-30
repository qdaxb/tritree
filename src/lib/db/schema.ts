import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// The raw DDL in client.ts is the authoritative migration source; this Drizzle schema mirrors table shape and constraints for future migration work.
export const rootMemory = sqliteTable("root_memory", {
  id: text("id").primaryKey(),
  preferencesJson: text("preferences_json").notNull(),
  summary: text("summary").notNull(),
  learnedSummary: text("learned_summary").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  prompt: text("prompt").notNull(),
  isSystem: integer("is_system").notNull(),
  defaultEnabled: integer("default_enabled").notNull(),
  isArchived: integer("is_archived").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    rootMemoryId: text("root_memory_id")
      .notNull()
      .references(() => rootMemory.id),
    title: text("title").notNull(),
    status: text("status").notNull(),
    currentNodeId: text("current_node_id"),
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
  roundIndex: integer("round_index").notNull(),
  roundIntent: text("round_intent").notNull(),
  optionsJson: text("options_json").notNull(),
  selectedOptionId: text("selected_option_id"),
  foldedOptionsJson: text("folded_options_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
});

export const draftVersions = sqliteTable("draft_versions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  nodeId: text("node_id")
    .notNull()
    .references(() => treeNodes.id),
  roundIndex: integer("round_index").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  hashtagsJson: text("hashtags_json").notNull(),
  imagePrompt: text("image_prompt").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
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

export const publishPackages = sqliteTable(
  "publish_packages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    nodeId: text("node_id")
      .notNull()
      .references(() => treeNodes.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    hashtagsJson: text("hashtags_json").notNull(),
    imagePrompt: text("image_prompt").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [unique("publish_packages_session_id_unique").on(table.sessionId)]
);

import { nanoid } from "nanoid";
import { getArtifactPlugin, requireArtifactPlugin } from "@/artifacts/registry";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  type CreateInitialAdminInput,
  type CreateUserInput,
  type OidcIdentity,
  type OidcIdentityUpsert,
  type UpdateUserInput,
  type User,
  type UserRole,
  type UserWithPasswordHash,
  CreateInitialAdminSchema,
  CreateUserSchema,
  CredentialsLoginSchema,
  OidcIdentitySchema,
  OidcIdentityUpsertSchema,
  ResetPasswordSchema,
  UpdateUserSchema,
  UserRoleSchema,
  UserSchema,
  UserWithPasswordHashSchema
} from "@/lib/auth/types";
import {
  type BranchOption,
  type AgentMessage,
  type CreationRequestOption,
  type CreationRequestOptionUpsert,
  type DirectorOptionsOutput,
  type OptionGenerationMode,
  type RootMemory,
  type RootPreferences,
  type Skill,
  type SkillUpsert,
  type SessionState,
  type TreeNode,
  type WorkSummary,
  AgentMessageSchema,
  BranchOptionSchema,
  CreationRequestOptionSchema,
  CreationRequestOptionUpsertSchema,
  DEFAULT_ARTIFACT_TYPE_ID,
  RootPreferencesSchema,
  SessionStateSchema,
  SessionStatusSchema,
  SkillSchema,
  SkillUpsertSchema,
  TreeNodeSchema,
  WorkSummarySchema,
  requireThreeOptions
} from "@/lib/domain";
import {
  defaultSkillInstallRoot,
  discoverInstalledSkills,
  stripSkillRuntimeMetadata,
  type InstalledSkillImport
} from "@/lib/skills/skill-installer";
import { compareSkillsForDisplay } from "@/lib/skills/skill-order";
import {
  loadConfiguredDefaults,
  type ConfiguredCreationRequestOption,
  type ConfiguredSystemSkill
} from "@/lib/defaults";
import { createDatabase, defaultDbPath } from "./client";

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string | null;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type OidcIdentityRow = {
  id: string;
  user_id: string;
  issuer: string;
  subject: string;
  email: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type RootMemoryRow = {
  id: string;
  user_id: string | null;
  preferences_json: string;
  summary: string;
  learned_summary: string;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  id: string;
  user_id: string | null;
  root_memory_id: string;
  artifact_type_id: string;
  title: string;
  status: string;
  current_node_id: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
};

type WorkSummaryRow = SessionRow & {
  current_round_index: number | null;
  latest_artifact_id: string | null;
};

type TreeNodeRow = {
  id: string;
  session_id: string;
  parent_id: string | null;
  parent_option_id: string | null;
  kind?: string;
  produced_artifact_id?: string | null;
  source_artifact_ids_json?: string;
  round_index: number;
  round_intent: string;
  options_json: string;
  selected_option_id: string | null;
  folded_options_json: string;
  agent_messages_json?: string;
  is_terminal?: number;
  created_at: string;
  updated_at?: string;
};

type ArtifactRow = {
  id: string;
  session_id: string;
  node_id: string;
  type: string;
  version: number;
  payload_json: string;
  source_artifact_ids_json: string;
  created_at: string;
  updated_at: string;
};

type BranchHistoryRow = {
  id: string;
  session_id: string;
  node_id: string;
  option_json: string;
  created_at: string;
};

type SkillRow = {
  id: string;
  user_id: string | null;
  title: string;
  category: string;
  description: string;
  prompt: string;
  applies_to: string;
  sort_order: number;
  is_system: number;
  default_enabled: number;
  default_loaded?: number;
  parent_skill_id?: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
};

type CreationRequestOptionRow = {
  id: string;
  user_id: string | null;
  label: string;
  sort_order: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
};

const MAX_NODE_AGENT_MESSAGES_JSON_CHARS = 48000;
const MAX_SESSION_TITLE_CHARS = 80;

function now() {
  return new Date().toISOString();
}

function truncateSessionTitle(title: string) {
  return Array.from(title.trim()).slice(0, MAX_SESSION_TITLE_CHARS).join("");
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseAgentMessages(value: string | null | undefined) {
  return AgentMessageSchema.array().parse(parseJson<unknown>(value || "[]"));
}

function appendAgentMessagesJson(currentJson: string | null | undefined, agentMessages: AgentMessage[] | undefined) {
  const incoming = AgentMessageSchema.array().parse(agentMessages ?? []);
  const existing = parseAgentMessages(currentJson);
  if (incoming.length === 0) return JSON.stringify(existing);

  const next = [...existing, ...incoming];
  while (next.length > 0 && JSON.stringify(next).length > MAX_NODE_AGENT_MESSAGES_JSON_CHARS) {
    next.shift();
  }
  return JSON.stringify(next);
}

function toUser(row: UserRow): User {
  return UserSchema.parse({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function toUserWithPasswordHash(row: UserRow): UserWithPasswordHash {
  return UserWithPasswordHashSchema.parse({
    ...toUser(row),
    passwordHash: row.password_hash
  });
}

function toOidcIdentity(row: OidcIdentityRow): OidcIdentity {
  return OidcIdentitySchema.parse({
    id: row.id,
    userId: row.user_id,
    issuer: row.issuer,
    subject: row.subject,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function withTransaction<T>(db: ReturnType<typeof createDatabase>, write: () => T) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = write();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function summarizePreferences(preferences: RootPreferences) {
  const artifactTypeId = preferences.artifactTypeId ?? DEFAULT_ARTIFACT_TYPE_ID;
  const seed = preferences.seed?.trim();
  const creationRequest = preferences.creationRequest?.trim();
  const requestParts = [
    artifactTypeId !== DEFAULT_ARTIFACT_TYPE_ID ? `作品类型：${artifactTypeId}` : "",
    creationRequest ? `本次创作要求：${creationRequest}` : ""
  ].filter(Boolean);

  if (seed) {
    return [`Seed：${seed}`, ...requestParts].join("\n");
  }

  return [
    [
      `领域：${preferences.domains.join("、")}`,
      `语气：${preferences.tones.join("、")}`,
      `表达：${preferences.styles.join("、")}`,
      `视角：${preferences.personas.join("、")}`
    ].join(" | "),
    ...requestParts
  ].join("\n");
}

function toRootMemory(row: RootMemoryRow): RootMemory {
  return {
    id: row.id,
    preferences: RootPreferencesSchema.parse(parseJson(row.preferences_json)),
    summary: row.summary,
    learnedSummary: row.learned_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rootMemoryForSession(row: RootMemoryRow, session: SessionRow, initialArtifact: ArtifactRow | undefined): RootMemory {
  const rootMemory = toRootMemory(row);
  const currentSeed = rootMemory.preferences.seed.trim();
  const initialSeed = initialArtifact ? artifactExcerpt(initialArtifact).trim() : "";
  const rootWasEditedAfterSessionStarted = row.updated_at > (initialArtifact?.created_at ?? session.created_at);
  if (!rootWasEditedAfterSessionStarted || !currentSeed || !initialSeed || currentSeed === initialSeed) return rootMemory;

  const preferences = RootPreferencesSchema.parse({
    ...rootMemory.preferences,
    seed: initialSeed,
    creationRequest: ""
  });
  return {
    ...rootMemory,
    preferences,
    summary: summarizePreferences(preferences)
  };
}

function toNode(row: TreeNodeRow): TreeNode {
  const options = parseJson<BranchOption[]>(row.options_json).map((option) => BranchOptionSchema.parse(option));
  const foldedOptions = parseJson<BranchOption[]>(row.folded_options_json).map((option) =>
    BranchOptionSchema.parse(option)
  );

  return TreeNodeSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    parentId: row.parent_id,
    parentOptionId: row.parent_option_id as BranchOption["id"] | null,
    kind: row.kind ?? "decision",
    producedArtifactId: row.produced_artifact_id ?? null,
    sourceArtifactIds: parseJson<string[]>(row.source_artifact_ids_json || "[]"),
    roundIndex: row.round_index,
    roundIntent: row.round_intent,
    options,
    selectedOptionId: row.selected_option_id as BranchOption["id"] | null,
    foldedOptions,
    agentMessages: parseAgentMessages(row.agent_messages_json),
    isTerminal: Boolean(row.is_terminal),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at
  });
}

function toArtifact(row: ArtifactRow) {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    payload: parseJson(row.payload_json),
    sourceArtifactIds: parseJson<string[]>(row.source_artifact_ids_json),
    createdByNodeId: row.node_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function artifactExcerpt(row: ArtifactRow | undefined) {
  if (!row) return "";
  const plugin = getArtifactPlugin(row.type);
  if (!plugin) return row.payload_json;
  const payload = plugin.payloadSchema.parse(parseJson(row.payload_json));
  return plugin.summarizeForTree(payload);
}

function toSkill(row: SkillRow): Skill {
  return SkillSchema.parse({
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    prompt: stripSkillRuntimeMetadata(row.prompt),
    appliesTo: row.applies_to || "both",
    isSystem: Boolean(row.is_system),
    sortOrder: row.sort_order,
    defaultEnabled: Boolean(row.default_enabled),
    defaultLoaded: row.default_loaded === undefined ? true : Boolean(row.default_loaded),
    parentSkillId: row.parent_skill_id ?? null,
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function toCreationRequestOption(row: CreationRequestOptionRow): CreationRequestOption {
  return CreationRequestOptionSchema.parse({
    id: row.id,
    label: row.label,
    sortOrder: row.sort_order,
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function uniqueSkillIds(skillIds: string[]) {
  return Array.from(new Set(skillIds.filter((id) => id.trim().length > 0)));
}

function activePathFor(nodes: TreeNode[], currentNode: TreeNode | null) {
  if (!currentNode) return [];

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const path: TreeNode[] = [];
  const visited = new Set<string>();
  let cursor: TreeNode | undefined = currentNode;

  while (cursor && !visited.has(cursor.id)) {
    path.unshift(cursor);
    visited.add(cursor.id);
    cursor = cursor.parentId ? nodesById.get(cursor.parentId) : undefined;
  }

  return path;
}

export function createTreeableRepository(
  dbPath = defaultDbPath(),
  {
    skillInstallRoot = defaultSkillInstallRoot(),
    defaultsConfigPath
  }: {
    skillInstallRoot?: string;
    defaultsConfigPath?: string;
  } = {}
) {
  const configuredDefaults = loadConfiguredDefaults({ configPath: defaultsConfigPath });
  const db = createDatabase(dbPath);
  try {
    cleanupStoredSkillRuntimePrompts();
    ensureSystemSkills(configuredDefaults.systemSkills);
    ensureDefaultCreationRequestOptions(configuredDefaults.creationRequestOptions);
  } catch (error) {
    db.close();
    throw error;
  }

  function cleanupStoredSkillRuntimePrompts() {
    const timestamp = now();
    const rows = db.prepare("SELECT id, prompt FROM skills").all() as Array<Pick<SkillRow, "id" | "prompt">>;
    for (const row of rows) {
      const normalizedPrompt = stripSkillRuntimeMetadata(row.prompt);
      if (normalizedPrompt === row.prompt) continue;
      db.prepare("UPDATE skills SET prompt = ?, updated_at = ? WHERE id = ?").run(normalizedPrompt, timestamp, row.id);
    }
  }

  function ensureSystemSkills(systemSkills: ConfiguredSystemSkill[]) {
    const timestamp = now();
    for (const [index, skill] of systemSkills.entries()) {
      const parsed = SkillUpsertSchema.parse(skill);
      const sortOrder = skill.sortOrder ?? index;
      const existing = db.prepare("SELECT * FROM skills WHERE id = ?").get(skill.id) as SkillRow | undefined;
      if (existing) {
        if (existing.user_id !== null || !existing.is_system) {
          throw new Error(`System skill config id ${skill.id} conflicts with an existing non-system skill.`);
        }
        db.prepare(
          `
            UPDATE skills
            SET user_id = NULL, title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, sort_order = ?, is_system = 1, default_enabled = ?, default_loaded = ?, parent_skill_id = ?, is_archived = ?, updated_at = ?
            WHERE id = ?
          `
        ).run(
          parsed.title,
          parsed.category,
          parsed.description,
          parsed.prompt,
          parsed.appliesTo,
          sortOrder,
          parsed.defaultEnabled ? 1 : 0,
          (parsed.defaultLoaded ?? true) ? 1 : 0,
          parsed.parentSkillId ?? null,
          parsed.isArchived ? 1 : 0,
          timestamp,
          skill.id
        );
      } else {
        db.prepare(
          `
            INSERT INTO skills (id, title, category, description, prompt, applies_to, sort_order, is_system, default_enabled, default_loaded, parent_skill_id, is_archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          skill.id,
          parsed.title,
          parsed.category,
          parsed.description,
          parsed.prompt,
          parsed.appliesTo,
          sortOrder,
          parsed.defaultEnabled ? 1 : 0,
          (parsed.defaultLoaded ?? true) ? 1 : 0,
          parsed.parentSkillId ?? null,
          parsed.isArchived ? 1 : 0,
          timestamp,
          timestamp
        );
      }
    }

    const configuredIds = systemSkills.map((skill) => skill.id);
    const placeholders = configuredIds.map(() => "?").join(", ");
    db.prepare(
      `
        UPDATE skills
        SET is_archived = 1, updated_at = ?
        WHERE user_id IS NULL
          AND is_system = 1
          AND is_archived = 0
          AND id NOT IN (${placeholders})
      `
    ).run(timestamp, ...configuredIds);
  }

  function ensureDefaultCreationRequestOptions(creationRequestOptions: ConfiguredCreationRequestOption[]) {
    const timestamp = now();

    creationRequestOptions.forEach((option, index) => {
      const sortOrder = option.sortOrder ?? index;
      const existing = db.prepare("SELECT * FROM creation_request_options WHERE id = ?").get(option.id) as
        | CreationRequestOptionRow
        | undefined;
      if (existing) {
        if (existing.user_id !== null) {
          throw new Error(`Defaults config creation request option id ${option.id} conflicts with an existing user option.`);
        }
        db.prepare(
          `
            UPDATE creation_request_options
            SET user_id = NULL, label = ?, sort_order = ?, is_archived = 0, updated_at = ?
            WHERE id = ?
          `
        ).run(option.label, sortOrder, timestamp, option.id);
        return;
      }

      db.prepare(
        `
          INSERT INTO creation_request_options (id, label, sort_order, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, 0, ?, ?)
        `
      ).run(option.id, option.label, sortOrder, timestamp, timestamp);
    });

    archiveRemovedDefaultCreationRequestOptions(creationRequestOptions, timestamp);
  }

  function archiveRemovedDefaultCreationRequestOptions(
    creationRequestOptions: ConfiguredCreationRequestOption[],
    timestamp: string
  ) {
    if (creationRequestOptions.length === 0) {
      db.prepare(
        `
          UPDATE creation_request_options
          SET is_archived = 1, updated_at = ?
          WHERE user_id IS NULL
            AND is_archived = 0
        `
      ).run(timestamp);
      return;
    }

    const configuredIds = creationRequestOptions.map((option) => option.id);
    const placeholders = configuredIds.map(() => "?").join(", ");
    db.prepare(
      `
        UPDATE creation_request_options
        SET is_archived = 1, updated_at = ?
        WHERE user_id IS NULL
          AND is_archived = 0
          AND id NOT IN (${placeholders})
      `
    ).run(timestamp, ...configuredIds);
  }

  function ensureUserCreationRequestOptions(userId: string) {
    const row = db
      .prepare("SELECT id FROM creation_request_options WHERE user_id = ? LIMIT 1")
      .get(userId);
    if (row) return;

    const timestamp = now();
    configuredDefaults.creationRequestOptions.forEach((option, index) => {
      db.prepare(
        `
          INSERT INTO creation_request_options (id, user_id, label, sort_order, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `
      ).run(nanoid(), userId, option.label, option.sortOrder ?? index, timestamp, timestamp);
    });
  }

  function listCreationRequestOptions(
    userId: string,
    { includeArchived = false }: { includeArchived?: boolean } = {}
  ) {
    ensureUserCreationRequestOptions(userId);
    const rows = db
      .prepare(
        includeArchived
          ? "SELECT * FROM creation_request_options WHERE user_id = ? ORDER BY sort_order, created_at, rowid"
          : "SELECT * FROM creation_request_options WHERE user_id = ? AND is_archived = 0 ORDER BY sort_order, created_at, rowid"
      )
      .all(userId) as CreationRequestOptionRow[];
    return rows.map(toCreationRequestOption);
  }

  function nextCreationRequestOptionSortOrder(userId: string) {
    const row = db
      .prepare("SELECT MAX(sort_order) AS max_sort_order FROM creation_request_options WHERE user_id = ?")
      .get(userId) as { max_sort_order: number | null } | undefined;
    return typeof row?.max_sort_order === "number" ? row.max_sort_order + 1 : 0;
  }

  function createCreationRequestOption(userId: string, input: CreationRequestOptionUpsert) {
    ensureUserCreationRequestOptions(userId);
    const parsed = CreationRequestOptionUpsertSchema.parse(input);
    const id = nanoid();
    const timestamp = now();
    const sortOrder = parsed.sortOrder ?? nextCreationRequestOptionSortOrder(userId);

    db.prepare(
      `
        INSERT INTO creation_request_options (id, user_id, label, sort_order, is_archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `
    ).run(id, userId, parsed.label, sortOrder, timestamp, timestamp);

    return toCreationRequestOption(
      db.prepare("SELECT * FROM creation_request_options WHERE id = ? AND user_id = ?").get(id, userId) as CreationRequestOptionRow
    );
  }

  function updateCreationRequestOption(userId: string, optionId: string, input: Partial<CreationRequestOptionUpsert>) {
    const existing = db.prepare("SELECT * FROM creation_request_options WHERE id = ? AND user_id = ?").get(optionId, userId) as
      | CreationRequestOptionRow
      | undefined;
    if (!existing) throw new Error("Creation request option was not found.");

    const parsed = CreationRequestOptionUpsertSchema.parse({
      label: input.label ?? existing.label,
      sortOrder: input.sortOrder ?? existing.sort_order
    });
    const timestamp = now();

    db.prepare(
      `
        UPDATE creation_request_options
        SET label = ?, sort_order = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `
    ).run(parsed.label, parsed.sortOrder ?? existing.sort_order, timestamp, optionId, userId);

    return toCreationRequestOption(
      db.prepare("SELECT * FROM creation_request_options WHERE id = ? AND user_id = ?").get(optionId, userId) as CreationRequestOptionRow
    );
  }

  function deleteCreationRequestOption(userId: string, optionId: string) {
    const existing = db.prepare("SELECT * FROM creation_request_options WHERE id = ? AND user_id = ?").get(optionId, userId) as
      | CreationRequestOptionRow
      | undefined;
    if (!existing) throw new Error("Creation request option was not found.");

    db.prepare(
      `
        UPDATE creation_request_options
        SET is_archived = 1, updated_at = ?
        WHERE id = ? AND user_id = ?
      `
    ).run(now(), optionId, userId);
  }

  function reorderCreationRequestOptions(userId: string, orderedIds: string[]) {
    ensureUserCreationRequestOptions(userId);
    const ids = Array.from(new Set(orderedIds));
    const existingIds = new Set(listCreationRequestOptions(userId).map((option) => option.id));
    const timestamp = now();
    const orderedKnownIds = ids.filter((id) => existingIds.has(id));
    const remainingIds = listCreationRequestOptions(userId)
      .map((option) => option.id)
      .filter((id) => !orderedKnownIds.includes(id));

    [...orderedKnownIds, ...remainingIds].forEach((id, index) => {
      db.prepare(
        `
          UPDATE creation_request_options
          SET sort_order = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      ).run(index, timestamp, id, userId);
    });

    return listCreationRequestOptions(userId);
  }

  function resetCreationRequestOptions(userId: string) {
    ensureUserCreationRequestOptions(userId);
    const timestamp = now();

    return withTransaction(db, () => {
      db.prepare("UPDATE creation_request_options SET is_archived = 1, updated_at = ? WHERE user_id = ?").run(timestamp, userId);

      configuredDefaults.creationRequestOptions.forEach((option, index) => {
        db.prepare(
          `
            INSERT INTO creation_request_options (id, user_id, label, sort_order, is_archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
          `
        ).run(nanoid(), userId, option.label, option.sortOrder ?? index, timestamp, timestamp);
      });

      return listCreationRequestOptions(userId);
    });
  }

  function listSkills(userId: string, { includeArchived = false }: { includeArchived?: boolean } = {}) {
    syncInstalledSkillsFromFolder();
    const rows = db
      .prepare(
        includeArchived
          ? `
            SELECT *
            FROM skills
            WHERE user_id IS NULL OR user_id = ?
              ORDER BY is_system DESC, sort_order, category, title
            `
          : `
              SELECT *
              FROM skills
              WHERE (user_id IS NULL OR user_id = ?) AND is_archived = 0
              ORDER BY is_system DESC, sort_order, category, title
            `
      )
      .all(userId) as SkillRow[];
    return rows.map(toSkill);
  }

  function defaultEnabledSkillIds() {
    const rows = db
      .prepare("SELECT * FROM skills WHERE is_system = 1 AND user_id IS NULL AND is_archived = 0")
      .all() as SkillRow[];
    return rows
      .map(toSkill)
      .filter((skill) => skill.defaultEnabled)
      .sort(compareSkillsForDisplay)
      .map((skill) => skill.id);
  }

  function resolveSkillsByIds(skillIds: string[], userId: string) {
    syncInstalledSkillsFromFolder();
    const ids = uniqueSkillIds(skillIds);
    if (ids.length === 0 || !userId) return [];
    return ids
      .map((id) =>
        db
          .prepare(
            `
              SELECT *
              FROM skills
              WHERE id = ?
                AND is_archived = 0
                AND (user_id IS NULL OR user_id = ?)
            `
          )
          .get(id, userId) as SkillRow | undefined
      )
      .filter((row): row is SkillRow => Boolean(row))
      .map(toSkill);
  }

  function createSkill(userId: string, input: SkillUpsert) {
    const parsed = SkillUpsertSchema.parse(input);
    const id = nanoid();
    const timestamp = now();
    db.prepare(
      `
        INSERT INTO skills (id, user_id, title, category, description, prompt, applies_to, is_system, default_enabled, default_loaded, parent_skill_id, is_archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      id,
      userId,
      parsed.title,
      parsed.category,
      parsed.description,
      parsed.prompt,
      parsed.appliesTo,
      parsed.defaultEnabled ? 1 : 0,
      (parsed.defaultLoaded ?? true) ? 1 : 0,
      parsed.parentSkillId ?? null,
      parsed.isArchived ? 1 : 0,
      timestamp,
      timestamp
    );
    return toSkill(db.prepare("SELECT * FROM skills WHERE id = ? AND user_id = ?").get(id, userId) as SkillRow);
  }

  function importSkills(inputs: InstalledSkillImport[]) {
    const timestamp = now();

    return withTransaction(db, () => {
      const imported: Skill[] = [];

      for (const input of inputs) {
        imported.push(upsertImportedSkill(input, timestamp, { allowSystemOverwrite: false }));
      }

      return imported;
    });
  }

  function syncInstalledSkillsFromFolder() {
    const timestamp = now();
    for (const installed of discoverInstalledSkills({ installRoot: skillInstallRoot })) {
      const existing = db.prepare("SELECT * FROM skills WHERE id = ?").get(installed.skill.id) as SkillRow | undefined;
      if (existing?.is_system) continue;
      upsertImportedSkill(installed.skill, timestamp, { allowSystemOverwrite: false });
    }
  }

  function upsertImportedSkill(
    input: InstalledSkillImport,
    timestamp: string,
    {
      allowSystemOverwrite
    }: {
      allowSystemOverwrite: boolean;
    }
  ) {
    const parsed = SkillUpsertSchema.parse(input);
    const existing = db.prepare("SELECT * FROM skills WHERE id = ?").get(input.id) as SkillRow | undefined;
    if (existing?.is_system && !allowSystemOverwrite) {
      throw new Error("System skills cannot be overwritten by imported skills.");
    }

    if (existing) {
      db.prepare(
        `
          UPDATE skills
          SET title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, default_enabled = ?, default_loaded = ?, parent_skill_id = ?, is_archived = ?, updated_at = ?
          WHERE id = ?
        `
      ).run(
        parsed.title,
        parsed.category,
        parsed.description,
        parsed.prompt,
        parsed.appliesTo,
        parsed.defaultEnabled ? 1 : 0,
        (parsed.defaultLoaded ?? true) ? 1 : 0,
        parsed.parentSkillId ?? null,
        parsed.isArchived ? 1 : 0,
        timestamp,
        input.id
      );
    } else {
      db.prepare(
        `
          INSERT INTO skills (id, title, category, description, prompt, applies_to, is_system, default_enabled, default_loaded, parent_skill_id, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        input.id,
        parsed.title,
        parsed.category,
        parsed.description,
        parsed.prompt,
        parsed.appliesTo,
        parsed.defaultEnabled ? 1 : 0,
        (parsed.defaultLoaded ?? true) ? 1 : 0,
        parsed.parentSkillId ?? null,
        parsed.isArchived ? 1 : 0,
        timestamp,
        timestamp
      );
    }

    return toSkill(db.prepare("SELECT * FROM skills WHERE id = ?").get(input.id) as SkillRow);
  }

  function updateSkill(userId: string, skillId: string, input: Partial<SkillUpsert>) {
    const existing = db
      .prepare("SELECT * FROM skills WHERE id = ? AND (user_id IS NULL OR user_id = ?)")
      .get(skillId, userId) as SkillRow | undefined;
    if (!existing) throw new Error("Skill was not found.");
    if (existing.is_system) throw new Error("System skills cannot be edited directly.");
    const parsed = SkillUpsertSchema.parse({
      title: input.title ?? existing.title,
      category: input.category ?? existing.category,
      description: input.description ?? existing.description,
      prompt: input.prompt ?? existing.prompt,
      appliesTo: input.appliesTo ?? existing.applies_to ?? "both",
      defaultEnabled: input.defaultEnabled ?? Boolean(existing.default_enabled),
      defaultLoaded: input.defaultLoaded ?? (existing.default_loaded === undefined ? true : Boolean(existing.default_loaded)),
      parentSkillId: input.parentSkillId === undefined ? existing.parent_skill_id ?? null : input.parentSkillId,
      isArchived: input.isArchived ?? Boolean(existing.is_archived)
    });
    const timestamp = now();
    db.prepare(
      `
        UPDATE skills
        SET title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, default_enabled = ?, default_loaded = ?, parent_skill_id = ?, is_archived = ?, updated_at = ?
        WHERE id = ? AND (user_id IS NULL OR user_id = ?)
      `
    ).run(
      parsed.title,
      parsed.category,
      parsed.description,
      parsed.prompt,
      parsed.appliesTo,
      parsed.defaultEnabled ? 1 : 0,
      (parsed.defaultLoaded ?? true) ? 1 : 0,
      parsed.parentSkillId ?? null,
      parsed.isArchived ? 1 : 0,
      timestamp,
      skillId,
      userId
    );
    return toSkill(db.prepare("SELECT * FROM skills WHERE id = ? AND (user_id IS NULL OR user_id = ?)").get(skillId, userId) as SkillRow);
  }

  function saveSessionEnabledSkills(sessionId: string, userId: string, skillIds: string[], timestamp: string) {
    syncInstalledSkillsFromFolder();
    db.prepare("DELETE FROM session_enabled_skills WHERE session_id = ?").run(sessionId);
    for (const skillId of uniqueSkillIds(skillIds)) {
      const exists = db
        .prepare(
          "SELECT id FROM skills WHERE id = ? AND is_archived = 0 AND (user_id IS NULL OR user_id = ?)"
        )
        .get(skillId, userId);
      if (!exists) continue;
      db.prepare(
        `
          INSERT INTO session_enabled_skills (session_id, skill_id, created_at)
          VALUES (?, ?, ?)
        `
      ).run(sessionId, skillId, timestamp);
    }
  }

  function enabledSkillsForSession(sessionId: string, userId: string) {
    const rows = db
      .prepare(
        `
          SELECT skills.*
          FROM session_enabled_skills
          JOIN skills ON skills.id = session_enabled_skills.skill_id
          WHERE session_enabled_skills.session_id = ?
            AND skills.is_archived = 0
            AND (skills.user_id IS NULL OR skills.user_id = ?)
          ORDER BY session_enabled_skills.created_at, session_enabled_skills.rowid
        `
      )
      .all(sessionId, userId) as SkillRow[];
    return rows.map(toSkill);
  }

  function replaceSessionEnabledSkills(userId: string, sessionId: string, skillIds: string[]) {
    const session = getActiveSession(userId, sessionId);
    if (!session) throw new Error("Session was not found.");
    const timestamp = now();
    return withTransaction(db, () => {
      saveSessionEnabledSkills(sessionId, userId, skillIds, timestamp);
      return getSessionState(userId, sessionId);
    });
  }

  function hasUsers() {
    const row = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    return row.count > 0;
  }

  async function createInitialAdmin(input: CreateInitialAdminInput) {
    const parsed = CreateInitialAdminSchema.parse(input);
    const passwordHash = await hashPassword(parsed.password);
    const timestamp = now();
    const id = nanoid();

    return withTransaction(db, () => {
      if (hasUsers()) {
        throw new Error("Initial administrator already exists.");
      }

      db.prepare(
        `
          INSERT INTO users (id, username, display_name, password_hash, role, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)
        `
      ).run(id, parsed.username, parsed.displayName, passwordHash, timestamp, timestamp);

      return getUser(id)!;
    });
  }

  async function createUser(input: CreateUserInput) {
    const parsed = CreateUserSchema.parse(input);
    const passwordHash = await hashPassword(parsed.password);
    const timestamp = now();
    const id = nanoid();

    db.prepare(
      `
        INSERT INTO users (id, username, display_name, password_hash, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(id, parsed.username, parsed.displayName, passwordHash, parsed.role, parsed.isActive ? 1 : 0, timestamp, timestamp);

    return getUser(id)!;
  }

  function listUsers() {
    const rows = db.prepare("SELECT * FROM users ORDER BY created_at, rowid").all() as UserRow[];
    return rows.map(toUser);
  }

  function listUsersWithOidcIdentities() {
    const users = listUsers();
    const identityRows = db.prepare("SELECT * FROM user_oidc_identities ORDER BY created_at, rowid").all() as OidcIdentityRow[];
    const identitiesByUserId = new Map<string, OidcIdentity[]>();

    for (const row of identityRows) {
      const identities = identitiesByUserId.get(row.user_id) ?? [];
      identities.push(toOidcIdentity(row));
      identitiesByUserId.set(row.user_id, identities);
    }

    return users.map((user) => ({
      ...user,
      oidcIdentities: identitiesByUserId.get(user.id) ?? []
    }));
  }

  function getUser(userId: string) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  function getUserWithPasswordHashByUsername(username: string) {
    const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim()) as UserRow | undefined;
    return row ? toUserWithPasswordHash(row) : null;
  }

  async function verifyPasswordLogin(username: string, password: string) {
    const parsed = CredentialsLoginSchema.parse({ username, password });
    const user = getUserWithPasswordHashByUsername(parsed.username);
    if (!user?.isActive || !user.passwordHash) return null;

    const isValid = await verifyPassword(parsed.password, user.passwordHash);
    if (!isValid) return null;

    return UserSchema.parse({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
  }

  async function resetUserPassword(userId: string, password: string) {
    const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
    if (!existing) throw new Error("User was not found.");

    const parsed = ResetPasswordSchema.parse({ password });
    const passwordHash = await hashPassword(parsed.password);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, now(), userId);

    return getUser(userId)!;
  }

  function updateUserDisplayName(userId: string, displayName: string) {
    const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
    if (!existing) throw new Error("User was not found.");

    const parsedDisplayName = UpdateUserSchema.shape.displayName.unwrap().parse(displayName);
    db.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(parsedDisplayName, now(), userId);
    return getUser(userId)!;
  }

  function activeAdminCountExcluding(userId: string) {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?")
      .get(userId) as { count: number };
    return row.count;
  }

  function setUserActive(userId: string, isActive: boolean) {
    const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
    if (!existing) throw new Error("User was not found.");

    if (
      existing.role === "admin" &&
      Boolean(existing.is_active) &&
      !isActive &&
      activeAdminCountExcluding(userId) === 0
    ) {
      throw new Error("Cannot deactivate the final active administrator.");
    }

    db.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?").run(isActive ? 1 : 0, now(), userId);
    return getUser(userId)!;
  }

  function setUserRole(userId: string, role: UserRole) {
    const parsedRole = UserRoleSchema.parse(role);
    const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
    if (!existing) throw new Error("User was not found.");

    if (
      existing.role === "admin" &&
      Boolean(existing.is_active) &&
      parsedRole !== "admin" &&
      activeAdminCountExcluding(userId) === 0
    ) {
      throw new Error("Cannot demote the final active administrator.");
    }

    db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(parsedRole, now(), userId);
    return getUser(userId)!;
  }

  function updateUser(userId: string, input: UpdateUserInput) {
    const parsed = UpdateUserSchema.parse(input);

    return withTransaction(db, () => {
      const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
      if (!existing) throw new Error("User was not found.");

      const nextRole = parsed.role ?? UserRoleSchema.parse(existing.role);
      const nextIsActive = parsed.isActive ?? Boolean(existing.is_active);
      if (existing.role === "admin" && Boolean(existing.is_active) && activeAdminCountExcluding(userId) === 0) {
        if (!nextIsActive) {
          throw new Error("Cannot deactivate the final active administrator.");
        }
        if (nextRole !== "admin") {
          throw new Error("Cannot demote the final active administrator.");
        }
      }

      const timestamp = now();
      if (parsed.displayName !== undefined) {
        db.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(parsed.displayName, timestamp, userId);
      }
      if (parsed.isActive !== undefined) {
        db.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?").run(parsed.isActive ? 1 : 0, timestamp, userId);
      }
      if (parsed.role !== undefined) {
        db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(parsed.role, timestamp, userId);
      }

      return getUser(userId)!;
    });
  }

  function bindOidcIdentity(userId: string, input: OidcIdentityUpsert) {
    const user = getUser(userId);
    if (!user) throw new Error("User was not found.");

    const parsed = OidcIdentityUpsertSchema.parse(input);
    const existing = db
      .prepare("SELECT id FROM user_oidc_identities WHERE issuer = ? AND subject = ?")
      .get(parsed.issuer, parsed.subject);
    if (existing) throw new Error("OIDC identity is already bound.");

    const id = nanoid();
    const timestamp = now();
    db.prepare(
      `
        INSERT INTO user_oidc_identities (id, user_id, issuer, subject, email, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(id, userId, parsed.issuer, parsed.subject, parsed.email, parsed.name, timestamp, timestamp);

    return toOidcIdentity(db.prepare("SELECT * FROM user_oidc_identities WHERE id = ?").get(id) as OidcIdentityRow);
  }

  function deleteOidcIdentity(identityId: string) {
    db.prepare("DELETE FROM user_oidc_identities WHERE id = ?").run(identityId);
  }

  function deleteOidcIdentityForUser(userId: string, identityId: string) {
    const result = db
      .prepare("DELETE FROM user_oidc_identities WHERE id = ? AND user_id = ?")
      .run(identityId, userId) as { changes: number };
    if (result.changes === 0) throw new Error("OIDC identity was not found.");
  }

  function findUserByOidcIdentity(issuer: string, subject: string) {
    const row = db
      .prepare(
        `
          SELECT users.*
          FROM user_oidc_identities
          JOIN users ON users.id = user_oidc_identities.user_id
          WHERE user_oidc_identities.issuer = ? AND user_oidc_identities.subject = ? AND users.is_active = 1
        `
      )
      .get(issuer.trim(), subject.trim()) as UserRow | undefined;

    return row ? toUser(row) : null;
  }

  function getRootMemory(userId: string) {
    const row = db
      .prepare(
        `
          SELECT *
          FROM root_memory
          WHERE user_id = ?
          ORDER BY updated_at DESC, created_at DESC, rowid DESC
          LIMIT 1
        `
      )
      .get(userId) as RootMemoryRow | undefined;
    return row ? toRootMemory(row) : null;
  }

  function saveRootMemory(userId: string, preferences: RootPreferences) {
    const parsed = RootPreferencesSchema.parse(preferences);
    const existing = getRootMemory(userId);
    const id = nanoid();
    const timestamp = now();
    const summary = summarizePreferences(parsed);

    db.prepare(
      `
        INSERT INTO root_memory (id, user_id, preferences_json, summary, learned_summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(id, userId, JSON.stringify(parsed), summary, existing?.learnedSummary ?? "", timestamp, timestamp);

    const row = db.prepare("SELECT * FROM root_memory WHERE id = ? AND user_id = ?").get(id, userId) as RootMemoryRow | undefined;
    if (!row) throw new Error("Failed to save root memory.");
    return toRootMemory(row);
  }

  function requireOwnedRootMemory(userId: string, rootMemoryId: string) {
    const rootRow = db.prepare("SELECT * FROM root_memory WHERE id = ? AND user_id = ?").get(rootMemoryId, userId) as
      | RootMemoryRow
      | undefined;
    const root = rootRow ? toRootMemory(rootRow) : null;
    if (!root) throw new Error("Root memory was not found.");
    return root;
  }

  function artifactTreeTitle(artifact: { type: string; payload: unknown } | null) {
    if (!artifact) return null;
    const plugin = requireArtifactPlugin(artifact.type);
    const parsedPayload = plugin.payloadSchema.parse(artifact.payload);
    return plugin.summarizeForTree(parsedPayload);
  }

  function insertArtifact({
    sessionId,
    nodeId,
    type,
    payload,
    sourceArtifactIds,
    timestamp
  }: {
    sessionId: string;
    nodeId: string;
    type: string;
    payload: unknown;
    sourceArtifactIds: string[];
    timestamp: string;
  }) {
    const plugin = requireArtifactPlugin(type);
    const parsedPayload = plugin.payloadSchema.parse(payload);
    const artifactId = nanoid();
    db.prepare(
      `
        INSERT INTO artifacts (id, session_id, node_id, type, version, payload_json, source_artifact_ids_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(artifactId, sessionId, nodeId, type, 1, JSON.stringify(parsedPayload), JSON.stringify(sourceArtifactIds), timestamp, timestamp);
    return artifactId;
  }

  function createWorkflowNodeWithOptionalArtifact({
    userId,
    rootMemoryId,
    artifactTypeId,
    enabledSkillIds,
    sessionTitle,
    parent,
    roundIntent,
    artifact
  }: {
    userId: string;
    rootMemoryId: string;
    artifactTypeId: string;
    enabledSkillIds?: string[];
    sessionTitle?: string;
    parent: {
      session: SessionRow;
      node: TreeNode;
      selectedOptionId: BranchOption["id"];
      options: BranchOption[];
    } | null;
    roundIntent: string;
    artifact: { type: string; payload: unknown; sourceArtifactIds?: string[] } | null;
  }) {
    const timestamp = now();
    const sessionId = parent?.session.id ?? nanoid();
    const nodeId = nanoid();
    const nextRoundIndex = parent ? parent.node.roundIndex + 1 : 1;
    const sourceArtifactIds = artifact?.sourceArtifactIds ?? [];
    const artifactTitle = artifactTreeTitle(artifact);
    const explicitSessionTitle = truncateSessionTitle(sessionTitle ?? "");
    const resolvedSessionTitle = explicitSessionTitle || artifactTitle || parent?.session.title || roundIntent || "Untitled Tree";

    return withTransaction(db, () => {
      if (parent) {
        saveNodeSelection(sessionId, parent.node.id, parent.options, parent.selectedOptionId, timestamp);
      } else {
        db.prepare(
          `
            INSERT INTO sessions (id, user_id, root_memory_id, artifact_type_id, title, status, current_node_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(sessionId, userId, rootMemoryId, artifactTypeId, resolvedSessionTitle, "active", nodeId, timestamp, timestamp);
      }

      db.prepare(
        `
          INSERT INTO tree_nodes (
            id,
            session_id,
            parent_id,
            parent_option_id,
            kind,
            produced_artifact_id,
            source_artifact_ids_json,
            round_index,
            round_intent,
            options_json,
            selected_option_id,
            folded_options_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        nodeId,
        sessionId,
        parent?.node.id ?? null,
        parent?.selectedOptionId ?? null,
        artifact ? "artifact" : "analysis",
        null,
        JSON.stringify(sourceArtifactIds),
        nextRoundIndex,
        roundIntent,
        "[]",
        null,
        "[]",
        timestamp,
        timestamp
      );

      const artifactId = artifact
        ? insertArtifact({
            sessionId,
            nodeId,
            type: artifact.type,
            payload: artifact.payload,
            sourceArtifactIds,
            timestamp
          })
        : null;

      db.prepare(
        `
          UPDATE tree_nodes
          SET produced_artifact_id = ?
          WHERE id = ?
        `
      ).run(artifactId, nodeId);

      if (parent) {
        db.prepare(
          `
            UPDATE sessions
            SET current_node_id = ?, title = ?, status = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
          `
        ).run(nodeId, resolvedSessionTitle, "active", timestamp, sessionId, userId);
      } else {
        saveSessionEnabledSkills(sessionId, userId, enabledSkillIds ?? defaultEnabledSkillIds(), timestamp);
      }

      const state = getSessionState(userId, sessionId);
      if (!state) {
        throw new Error("Failed to create workflow node state.");
      }
      return state;
    });
  }

  function createSession({ userId, enabledSkillIds, rootMemoryId }: { userId: string; enabledSkillIds?: string[]; rootMemoryId: string }) {
    const root = requireOwnedRootMemory(userId, rootMemoryId);
    const plugin = requireArtifactPlugin(root.preferences.artifactTypeId ?? DEFAULT_ARTIFACT_TYPE_ID);
    const seedPayload = plugin.createSeedPayload({
      creationRequest: root.preferences.creationRequest,
      seed: root.preferences.seed,
      skills: []
    });
    return createWorkflowNodeWithOptionalArtifact({
      userId,
      rootMemoryId,
      artifactTypeId: plugin.id,
      enabledSkillIds,
      sessionTitle: root.preferences.seed,
      parent: null,
      roundIntent: seedPayload ? plugin.summarizeForTree(seedPayload) : "种子念头",
      artifact: seedPayload ? { type: plugin.id, payload: seedPayload, sourceArtifactIds: [] } : null
    });
  }

  function createArtifactChild(input: {
    artifact: { type: string; payload: unknown; sourceArtifactIds?: string[] } | null;
    customOption?: BranchOption;
    optionMode?: OptionGenerationMode;
    roundIntent?: string;
    selectedOptionId: BranchOption["id"];
    sessionId: string;
    nodeId: string;
    userId: string;
  }): SessionState {
    const session = getActiveSession(input.userId, input.sessionId);
    if (!session) {
      throw new Error("Session was not found.");
    }

    const current = db.prepare("SELECT * FROM tree_nodes WHERE id = ?").get(input.nodeId) as TreeNodeRow | undefined;
    if (!current || current.session_id !== input.sessionId) {
      throw new Error("Parent tree node was not found.");
    }

    const parentNode = toNode(current);
    const parsedCustomOption = input.customOption ? BranchOptionSchema.parse(input.customOption) : null;
    if (parsedCustomOption && parsedCustomOption.id !== input.selectedOptionId) {
      throw new Error("Custom option must match the selected option.");
    }
    const optionsWithCustom = parsedCustomOption
      ? [...parentNode.options.filter((option) => option.id !== parsedCustomOption.id), parsedCustomOption]
      : parentNode.options;
    const parentOptions = optionsWithCustom.map((option) =>
      option.id === input.selectedOptionId && input.optionMode ? { ...option, mode: input.optionMode } : option
    );
    const selected = parentOptions.find((option) => option.id === input.selectedOptionId);
    if (!selected && parentOptions.length > 0) {
      throw new Error("Selected option is not part of the parent node.");
    }

    return createWorkflowNodeWithOptionalArtifact({
      userId: input.userId,
      rootMemoryId: session.root_memory_id,
      artifactTypeId: session.artifact_type_id || DEFAULT_ARTIFACT_TYPE_ID,
      parent: {
        session,
        node: parentNode,
        selectedOptionId: input.selectedOptionId,
        options: parentOptions
      },
      roundIntent: input.roundIntent ?? selected?.label ?? "继续",
      artifact: input.artifact
    });
  }

  function updateNodeArtifact(input: {
    agentMessages?: AgentMessage[];
    artifact: { type: string; payload: unknown; sourceArtifactIds?: string[] } | null;
    nodeId: string;
    roundIntent: string;
    sessionId: string;
    userId: string;
  }): SessionState {
    const session = getActiveSession(input.userId, input.sessionId);
    if (!session) {
      throw new Error("Session was not found.");
    }
    const target = db.prepare("SELECT * FROM tree_nodes WHERE id = ?").get(input.nodeId) as TreeNodeRow | undefined;
    if (!target || target.session_id !== input.sessionId) {
      throw new Error("Tree node was not found.");
    }

    const timestamp = now();
    const sourceArtifactIds = input.artifact?.sourceArtifactIds ?? [];
    const agentMessagesJson = appendAgentMessagesJson(target.agent_messages_json, input.agentMessages);
    const title = artifactTreeTitle(input.artifact) ?? session.title;

    return withTransaction(db, () => {
      const artifactId = input.artifact
        ? insertArtifact({
            sessionId: input.sessionId,
            nodeId: input.nodeId,
            type: input.artifact.type,
            payload: input.artifact.payload,
            sourceArtifactIds,
            timestamp
          })
        : null;

      db.prepare(
        `
          UPDATE tree_nodes
          SET round_intent = ?,
              kind = ?,
              produced_artifact_id = ?,
              source_artifact_ids_json = ?,
              agent_messages_json = ?,
              updated_at = ?
          WHERE id = ?
        `
      ).run(
        input.roundIntent,
        input.artifact ? "artifact" : "analysis",
        artifactId,
        JSON.stringify(sourceArtifactIds),
        agentMessagesJson,
        timestamp,
        input.nodeId
      );

      db.prepare(
        `
          UPDATE sessions
          SET title = ?, status = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      ).run(title, "active", timestamp, input.sessionId, input.userId);

      const state = getSessionState(input.userId, input.sessionId);
      if (!state) {
        throw new Error("Failed to update node artifact.");
      }
      return state;
    });
  }

  function updateNodeOptions({
    userId,
    sessionId,
    nodeId,
    output,
    agentMessages
  }: {
    userId: string;
    sessionId: string;
    nodeId: string;
    output: DirectorOptionsOutput;
    agentMessages?: AgentMessage[];
  }) {
    requireThreeOptions(output.options);
    const session = getActiveSession(userId, sessionId);
    if (!session) {
      throw new Error("Session was not found.");
    }
    const target = db.prepare("SELECT * FROM tree_nodes WHERE id = ?").get(nodeId) as TreeNodeRow | undefined;
    if (!target || target.session_id !== sessionId) {
      throw new Error("Tree node was not found.");
    }

    const timestamp = now();
    const agentMessagesJson = appendAgentMessagesJson(target.agent_messages_json, agentMessages);

    return withTransaction(db, () => {
      db.prepare(
        `
          UPDATE tree_nodes
          SET round_intent = ?, options_json = ?, agent_messages_json = ?, updated_at = ?
          WHERE id = ?
        `
      ).run(output.roundIntent, JSON.stringify(output.options), agentMessagesJson, timestamp, nodeId);

      db.prepare(
        `
          UPDATE sessions
          SET updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      ).run(timestamp, sessionId, userId);

      const state = getSessionState(userId, sessionId);
      if (!state) {
        throw new Error("Failed to update session options.");
      }
      return state;
    });
  }

  function completeNode({
    userId,
    sessionId,
    nodeId,
    output,
    agentMessages,
    artifact = null
  }: {
    userId: string;
    sessionId: string;
    nodeId: string;
    output: { roundIntent: string };
    agentMessages?: AgentMessage[];
    artifact?: { type: string; payload: unknown; sourceArtifactIds?: string[] } | null;
  }) {
    const session = getActiveSession(userId, sessionId);
    if (!session) {
      throw new Error("Session was not found.");
    }
    const target = db.prepare("SELECT * FROM tree_nodes WHERE id = ?").get(nodeId) as TreeNodeRow | undefined;
    if (!target || target.session_id !== sessionId) {
      throw new Error("Tree node was not found.");
    }

    const timestamp = now();
    const sourceArtifactIds = artifact?.sourceArtifactIds ?? [];
    const agentMessagesJson = appendAgentMessagesJson(target.agent_messages_json, agentMessages);
    const title = artifactTreeTitle(artifact) ?? session.title;

    return withTransaction(db, () => {
      const artifactId = artifact
        ? insertArtifact({
            sessionId,
            nodeId,
            type: artifact.type,
            payload: artifact.payload,
            sourceArtifactIds,
            timestamp
          })
        : null;

      db.prepare(
        `
          UPDATE tree_nodes
          SET round_intent = ?,
              options_json = '[]',
              kind = ?,
              produced_artifact_id = ?,
              source_artifact_ids_json = ?,
              agent_messages_json = ?,
              is_terminal = 1,
              updated_at = ?
          WHERE id = ?
        `
      ).run(
        output.roundIntent,
        artifact ? "artifact" : "analysis",
        artifactId,
        JSON.stringify(sourceArtifactIds),
        agentMessagesJson,
        timestamp,
        nodeId
      );

      db.prepare(
        `
          UPDATE sessions
          SET title = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      ).run(title, timestamp, sessionId, userId);

      const state = getSessionState(userId, sessionId);
      if (!state) {
        throw new Error("Failed to complete tree node.");
      }
      return state;
    });
  }

  function activateHistoricalBranch({
    userId,
    sessionId,
    nodeId,
    selectedOptionId
  }: {
    userId: string;
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
  }) {
    const session = getActiveSession(userId, sessionId);
    if (!session) {
      throw new Error("Session was not found.");
    }
    const parent = getNodeForSelection(sessionId, nodeId);

    const existingChild = db
      .prepare(
        `
          SELECT *
          FROM tree_nodes
          WHERE session_id = ? AND parent_id = ? AND parent_option_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1
        `
      )
      .get(sessionId, nodeId, selectedOptionId) as TreeNodeRow | undefined;
    if (!existingChild) return null;

    const selectedOptions = optionsWithSelection(parent, selectedOptionId);
    const timestamp = now();
    return withTransaction(db, () => {
      saveNodeSelection(sessionId, nodeId, selectedOptions, selectedOptionId, timestamp);
      const artifact = existingChild.produced_artifact_id
        ? (db.prepare("SELECT * FROM artifacts WHERE id = ?").get(existingChild.produced_artifact_id) as
            | ArtifactRow
            | undefined)
        : undefined;
      db.prepare(
        `
          UPDATE sessions
          SET current_node_id = ?, title = ?, status = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      ).run(existingChild.id, artifactExcerpt(artifact) || session.title, "active", timestamp, sessionId, userId);

      return getSessionState(userId, sessionId);
    });
  }

  function getNodeForSelection(sessionId: string, nodeId: string) {
    const row = db.prepare("SELECT * FROM tree_nodes WHERE id = ?").get(nodeId) as TreeNodeRow | undefined;
    if (!row || row.session_id !== sessionId) {
      throw new Error("Historical tree node was not found.");
    }
    return toNode(row);
  }

  function optionsWithSelection(
    node: TreeNode,
    selectedOptionId: BranchOption["id"],
    optionMode?: OptionGenerationMode
  ) {
    const currentOptions = node.options.map((option) =>
      option.id === selectedOptionId && optionMode ? { ...option, mode: optionMode } : option
    );
    const selected = currentOptions.find((option) => option.id === selectedOptionId);
    if (!selected) {
      throw new Error("Selected option is not part of the historical node.");
    }
    return currentOptions;
  }

  function saveNodeSelection(
    sessionId: string,
    nodeId: string,
    options: BranchOption[],
    selectedOptionId: BranchOption["id"],
    timestamp: string
  ) {
    const folded = options.filter((option) => option.id !== selectedOptionId);
    db.prepare(
      `
        UPDATE tree_nodes
        SET options_json = ?, selected_option_id = ?, folded_options_json = ?, updated_at = ?
        WHERE id = ?
      `
    ).run(JSON.stringify(options), selectedOptionId, JSON.stringify(folded), timestamp, nodeId);
    db.prepare("DELETE FROM branch_history WHERE session_id = ? AND node_id = ?").run(sessionId, nodeId);
    for (const option of folded) {
      db.prepare(
        `
          INSERT INTO branch_history (id, session_id, node_id, option_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
      ).run(nanoid(), sessionId, nodeId, JSON.stringify(option), timestamp);
    }
  }

  function getActiveSession(userId: string, sessionId: string) {
    return db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ? AND is_archived = 0").get(sessionId, userId) as
      | SessionRow
      | undefined;
  }

  function toWorkSummary(row: WorkSummaryRow): WorkSummary {
    const artifactRow = row.latest_artifact_id
      ? (db.prepare("SELECT * FROM artifacts WHERE id = ?").get(row.latest_artifact_id) as ArtifactRow | undefined)
      : undefined;
    const excerpt = artifactExcerpt(artifactRow);
    return WorkSummarySchema.parse({
      id: row.id,
      title: row.title,
      status: SessionStatusSchema.parse(row.status),
      currentNodeId: row.current_node_id,
      currentRoundIndex: row.current_round_index,
      artifactExcerpt: Array.from(excerpt).slice(0, 120).join(""),
      artifactSummaryLength: Array.from(excerpt).length,
      isArchived: Boolean(row.is_archived),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  function getSessionSummary(userId: string, sessionId: string) {
    const row = db
      .prepare(
        `
          SELECT
            sessions.*,
            current_node.round_index AS current_round_index,
            COALESCE(current_artifact.id, latest_artifact.id) AS latest_artifact_id
          FROM sessions
          LEFT JOIN tree_nodes AS current_node
            ON current_node.id = sessions.current_node_id
          LEFT JOIN artifacts AS current_artifact
            ON current_artifact.id = current_node.produced_artifact_id
          LEFT JOIN artifacts AS latest_artifact
            ON latest_artifact.id = (
              SELECT linked_artifacts.id
              FROM tree_nodes AS linked_nodes
              JOIN artifacts AS linked_artifacts
                ON linked_artifacts.id = linked_nodes.produced_artifact_id
              WHERE linked_nodes.session_id = sessions.id
                AND linked_nodes.produced_artifact_id IS NOT NULL
              ORDER BY linked_artifacts.updated_at DESC, linked_artifacts.created_at DESC, linked_artifacts.rowid DESC
              LIMIT 1
            )
          WHERE sessions.id = ?
            AND sessions.user_id = ?
        `
      )
      .get(sessionId, userId) as WorkSummaryRow | undefined;

    return row ? toWorkSummary(row) : null;
  }

  function listSessionSummaries(userId: string, { archived = false }: { archived?: boolean } = {}) {
    const rows = db
      .prepare(
        `
          SELECT
            sessions.*,
            current_node.round_index AS current_round_index,
            COALESCE(current_artifact.id, latest_artifact.id) AS latest_artifact_id
          FROM sessions
          LEFT JOIN tree_nodes AS current_node
            ON current_node.id = sessions.current_node_id
          LEFT JOIN artifacts AS current_artifact
            ON current_artifact.id = current_node.produced_artifact_id
          LEFT JOIN artifacts AS latest_artifact
            ON latest_artifact.id = (
              SELECT linked_artifacts.id
              FROM tree_nodes AS linked_nodes
              JOIN artifacts AS linked_artifacts
                ON linked_artifacts.id = linked_nodes.produced_artifact_id
              WHERE linked_nodes.session_id = sessions.id
                AND linked_nodes.produced_artifact_id IS NOT NULL
              ORDER BY linked_artifacts.updated_at DESC, linked_artifacts.created_at DESC, linked_artifacts.rowid DESC
              LIMIT 1
            )
          WHERE sessions.user_id = ?
            AND sessions.is_archived = ?
          ORDER BY sessions.updated_at DESC, sessions.created_at DESC, sessions.rowid DESC
        `
      )
      .all(userId, archived ? 1 : 0) as WorkSummaryRow[];

    return rows.map(toWorkSummary);
  }

  function renameSession(userId: string, sessionId: string, title: string) {
    const timestamp = now();
    const result = db
      .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ? AND is_archived = 0")
      .run(title, timestamp, sessionId, userId) as { changes: number };
    return result.changes > 0 ? getSessionSummary(userId, sessionId) : null;
  }

  function archiveSession(userId: string, sessionId: string) {
    const timestamp = now();
    const result = db
      .prepare("UPDATE sessions SET is_archived = 1, updated_at = ? WHERE id = ? AND user_id = ? AND is_archived = 0")
      .run(timestamp, sessionId, userId) as { changes: number };
    return result.changes > 0 ? getSessionSummary(userId, sessionId) : null;
  }

  function getSessionState(userId: string, sessionId: string): SessionState | null {
    const session = getActiveSession(userId, sessionId);
    if (!session) return null;

    const root = db.prepare("SELECT * FROM root_memory WHERE id = ? AND user_id = ?").get(session.root_memory_id, userId) as
      | RootMemoryRow
      | undefined;
    if (!root) return null;

    const nodes = (db.prepare("SELECT * FROM tree_nodes WHERE session_id = ?").all(sessionId) as TreeNodeRow[])
      .map(toNode)
      .sort((a, b) => a.roundIndex - b.roundIndex);
    const artifactRows = db.prepare("SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at ASC, rowid ASC").all(sessionId) as ArtifactRow[];
    const artifacts = artifactRows.map(toArtifact);
    const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const currentNode = session.current_node_id ? nodes.find((node) => node.id === session.current_node_id) ?? null : null;
    const currentArtifact = currentNode?.producedArtifactId ? artifactById.get(currentNode.producedArtifactId) ?? null : null;
    const nodeArtifacts = nodes.flatMap((node) => {
      const artifact = node.producedArtifactId ? artifactById.get(node.producedArtifactId) : null;
      return artifact ? [{ nodeId: node.id, artifact }] : [];
    });
    const historyRows = db.prepare("SELECT * FROM branch_history WHERE session_id = ?").all(sessionId) as BranchHistoryRow[];
    const selectedPath = activePathFor(nodes, currentNode);
    const enabledSkills = enabledSkillsForSession(sessionId, userId);

    return SessionStateSchema.parse({
      rootMemory: rootMemoryForSession(root, session, artifactRows[0]),
      session: {
        artifactTypeId: session.artifact_type_id || DEFAULT_ARTIFACT_TYPE_ID,
        id: session.id,
        title: session.title,
        status: SessionStatusSchema.parse(session.status === "finished" ? "active" : session.status),
        currentNodeId: session.current_node_id,
        createdAt: session.created_at,
        updatedAt: session.updated_at
      },
      currentNode,
      currentArtifact,
      artifacts,
      nodeArtifacts,
      selectedPath,
      treeNodes: nodes,
      enabledSkillIds: enabledSkills.map((skill) => skill.id),
      enabledSkills,
      foldedBranches: historyRows.map((row) => ({
        id: row.id,
        nodeId: row.node_id,
        option: BranchOptionSchema.parse(parseJson(row.option_json)),
        createdAt: row.created_at
      }))
    });
  }

  function getLatestSessionState(userId: string): SessionState | null {
    const row = db
      .prepare(
        "SELECT id FROM sessions WHERE user_id = ? AND is_archived = 0 ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1"
      )
      .get(userId) as { id: string } | undefined;

    return row ? getSessionState(userId, row.id) : null;
  }

  return {
    createInitialAdmin,
    createUser,
    listUsers,
    listUsersWithOidcIdentities,
    getUser,
    getUserWithPasswordHashByUsername,
    verifyPasswordLogin,
    resetUserPassword,
    updateUser,
    updateUserDisplayName,
    setUserActive,
    setUserRole,
    bindOidcIdentity,
    deleteOidcIdentity,
    deleteOidcIdentityForUser,
    findUserByOidcIdentity,
    hasUsers,
    getRootMemory,
    saveRootMemory,
    listCreationRequestOptions,
    createCreationRequestOption,
    updateCreationRequestOption,
    deleteCreationRequestOption,
    reorderCreationRequestOptions,
    resetCreationRequestOptions,
    listSkills,
    createSkill,
    importSkills,
    updateSkill,
    defaultEnabledSkillIds,
    resolveSkillsByIds,
    replaceSessionEnabledSkills,
    createSession,
    createArtifactChild,
    updateNodeArtifact,
    completeNode,
    activateHistoricalBranch,
    updateNodeOptions,
    listSessionSummaries,
    renameSession,
    archiveSession,
    getSessionState,
    getLatestSessionState
  };
}

type TreeableRepository = ReturnType<typeof createTreeableRepository>;

let repositoryInstance: TreeableRepository | null = null;

export function getRepository() {
  repositoryInstance ??= createTreeableRepository();
  return repositoryInstance;
}

export const repository = new Proxy({} as TreeableRepository, {
  get(_target, property, receiver) {
    return Reflect.get(getRepository(), property, receiver);
  }
});

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
import { createDatabase, resolveDatabaseConfig, type DatabaseConfig, type TritreeDrizzleDatabase } from "./client";

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

function withTransaction<T>(db: TritreeDrizzleDatabase, write: () => T | Promise<T>) {
  return db.transaction(write);
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

export async function createTritreeRepository(
  dbConfig: string | DatabaseConfig = resolveDatabaseConfig(),
  {
    skillInstallRoot = defaultSkillInstallRoot(),
    defaultsConfigPath
  }: {
    skillInstallRoot?: string;
    defaultsConfigPath?: string;
  } = {}
) {
  const configuredDefaults = loadConfiguredDefaults({ configPath: defaultsConfigPath });
  const db = await createDatabase(typeof dbConfig === "string" ? { provider: "sqlite", path: dbConfig } : dbConfig);
  try {
    await cleanupStoredSkillRuntimePrompts();
    await ensureSystemSkills(configuredDefaults.systemSkills);
    await ensureDefaultCreationRequestOptions(configuredDefaults.creationRequestOptions);
  } catch (error) {
    await db.close();
    throw error;
  }

  async function cleanupStoredSkillRuntimePrompts() {
    const timestamp = now();
    const rows = await db.queryAll<Pick<SkillRow, "id" | "prompt">>("SELECT id, prompt FROM skills");
    for (const row of rows) {
      const normalizedPrompt = stripSkillRuntimeMetadata(row.prompt);
      if (normalizedPrompt === row.prompt) continue;
      await db.execute("UPDATE skills SET prompt = ?, updated_at = ? WHERE id = ?", normalizedPrompt, timestamp, row.id);
    }
  }

  async function ensureSystemSkills(systemSkills: ConfiguredSystemSkill[]) {
    const timestamp = now();
    for (const [index, skill] of systemSkills.entries()) {
      const parsed = SkillUpsertSchema.parse(skill);
      const sortOrder = skill.sortOrder ?? index;
      const existing = await db.queryGet<SkillRow>("SELECT * FROM skills WHERE id = ?", skill.id);
      if (existing) {
        if (existing.user_id !== null || !existing.is_system) {
          throw new Error(`System skill config id ${skill.id} conflicts with an existing non-system skill.`);
        }
        await db.execute(
          `
            UPDATE skills
            SET user_id = NULL, title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, sort_order = ?, is_system = 1, default_enabled = ?, default_loaded = ?, parent_skill_id = ?, is_archived = ?, updated_at = ?
            WHERE id = ?
          `
        ,
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
        await db.execute(
          `
            INSERT INTO skills (id, title, category, description, prompt, applies_to, sort_order, is_system, default_enabled, default_loaded, parent_skill_id, is_archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
          `
        ,
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
    await db.execute(
      `
        UPDATE skills
        SET is_archived = 1, updated_at = ?
        WHERE user_id IS NULL
          AND is_system = 1
          AND is_archived = 0
          AND id NOT IN (${placeholders})
      `
    , timestamp, ...configuredIds);
  }

  async function ensureDefaultCreationRequestOptions(creationRequestOptions: ConfiguredCreationRequestOption[]) {
    const timestamp = now();

    for (const [index, option] of creationRequestOptions.entries()) {
      const sortOrder = option.sortOrder ?? index;
      const existing = await db.queryGet<CreationRequestOptionRow>("SELECT * FROM creation_request_options WHERE id = ?", option.id);
      if (existing) {
        if (existing.user_id !== null) {
          throw new Error(`Defaults config creation request option id ${option.id} conflicts with an existing user option.`);
        }
        await db.execute(
          `
            UPDATE creation_request_options
            SET user_id = NULL, label = ?, sort_order = ?, is_archived = 0, updated_at = ?
            WHERE id = ?
          `
        , option.label, sortOrder, timestamp, option.id);
        continue;
      }

      await db.execute(
        `
          INSERT INTO creation_request_options (id, label, sort_order, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, 0, ?, ?)
        `
      , option.id, option.label, sortOrder, timestamp, timestamp);
    }

    await archiveRemovedDefaultCreationRequestOptions(creationRequestOptions, timestamp);
  }

  async function archiveRemovedDefaultCreationRequestOptions(
    creationRequestOptions: ConfiguredCreationRequestOption[],
    timestamp: string
  ) {
    if (creationRequestOptions.length === 0) {
      await db.execute(
        `
          UPDATE creation_request_options
          SET is_archived = 1, updated_at = ?
          WHERE user_id IS NULL
            AND is_archived = 0
        `
      , timestamp);
      return;
    }

    const configuredIds = creationRequestOptions.map((option) => option.id);
    const placeholders = configuredIds.map(() => "?").join(", ");
    await db.execute(
      `
        UPDATE creation_request_options
        SET is_archived = 1, updated_at = ?
        WHERE user_id IS NULL
          AND is_archived = 0
          AND id NOT IN (${placeholders})
      `
    , timestamp, ...configuredIds);
  }

  async function ensureUserCreationRequestOptions(userId: string) {
    const row = await db.queryGet("SELECT id FROM creation_request_options WHERE user_id = ? LIMIT 1", userId);
    if (row) return;

    const timestamp = now();
    for (const [index, option] of configuredDefaults.creationRequestOptions.entries()) {
      await db.execute(
        `
          INSERT INTO creation_request_options (id, user_id, label, sort_order, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `
      , nanoid(), userId, option.label, option.sortOrder ?? index, timestamp, timestamp);
    }
  }

  async function listCreationRequestOptions(
    userId: string,
    { includeArchived = false }: { includeArchived?: boolean } = {}
  ) {
    await ensureUserCreationRequestOptions(userId);
    const rows = await db.queryAll<CreationRequestOptionRow>(
      includeArchived
        ? "SELECT * FROM creation_request_options WHERE user_id = ? ORDER BY sort_order, created_at, rowid"
        : "SELECT * FROM creation_request_options WHERE user_id = ? AND is_archived = 0 ORDER BY sort_order, created_at, rowid",
      userId
    );
    return rows.map(toCreationRequestOption);
  }

  async function nextCreationRequestOptionSortOrder(userId: string) {
    const row = await db.queryGet<{ max_sort_order: number | null }>(
      "SELECT MAX(sort_order) AS max_sort_order FROM creation_request_options WHERE user_id = ?",
      userId
    );
    return typeof row?.max_sort_order === "number" ? row.max_sort_order + 1 : 0;
  }

  async function createCreationRequestOption(userId: string, input: CreationRequestOptionUpsert) {
    await ensureUserCreationRequestOptions(userId);
    const parsed = CreationRequestOptionUpsertSchema.parse(input);
    const id = nanoid();
    const timestamp = now();
    const sortOrder = parsed.sortOrder ?? (await nextCreationRequestOptionSortOrder(userId));

    await db.execute(
      `
        INSERT INTO creation_request_options (id, user_id, label, sort_order, is_archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `
    , id, userId, parsed.label, sortOrder, timestamp, timestamp);

    return toCreationRequestOption(
      (await db.queryGet<CreationRequestOptionRow>("SELECT * FROM creation_request_options WHERE id = ? AND user_id = ?", id, userId))!
    );
  }

  async function updateCreationRequestOption(userId: string, optionId: string, input: Partial<CreationRequestOptionUpsert>) {
    const existing = await db.queryGet<CreationRequestOptionRow>(
      "SELECT * FROM creation_request_options WHERE id = ? AND user_id = ?",
      optionId,
      userId
    );
    if (!existing) throw new Error("Creation request option was not found.");

    const parsed = CreationRequestOptionUpsertSchema.parse({
      label: input.label ?? existing.label,
      sortOrder: input.sortOrder ?? existing.sort_order
    });
    const timestamp = now();

    await db.execute(
      `
        UPDATE creation_request_options
        SET label = ?, sort_order = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `
    , parsed.label, parsed.sortOrder ?? existing.sort_order, timestamp, optionId, userId);

    return toCreationRequestOption(
      (await db.queryGet<CreationRequestOptionRow>("SELECT * FROM creation_request_options WHERE id = ? AND user_id = ?", optionId, userId))!
    );
  }

  async function deleteCreationRequestOption(userId: string, optionId: string) {
    const existing = await db.queryGet<CreationRequestOptionRow>(
      "SELECT * FROM creation_request_options WHERE id = ? AND user_id = ?",
      optionId,
      userId
    );
    if (!existing) throw new Error("Creation request option was not found.");

    await db.execute(
      `
        UPDATE creation_request_options
        SET is_archived = 1, updated_at = ?
        WHERE id = ? AND user_id = ?
      `
    , now(), optionId, userId);
  }

  async function reorderCreationRequestOptions(userId: string, orderedIds: string[]) {
    await ensureUserCreationRequestOptions(userId);
    const ids = Array.from(new Set(orderedIds));
    const existingOptions = await listCreationRequestOptions(userId);
    const existingIds = new Set(existingOptions.map((option) => option.id));
    const timestamp = now();
    const orderedKnownIds = ids.filter((id) => existingIds.has(id));
    const remainingIds = existingOptions
      .map((option) => option.id)
      .filter((id) => !orderedKnownIds.includes(id));

    for (const [index, id] of [...orderedKnownIds, ...remainingIds].entries()) {
      await db.execute(
        `
          UPDATE creation_request_options
          SET sort_order = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      , index, timestamp, id, userId);
    }

    return listCreationRequestOptions(userId);
  }

  async function resetCreationRequestOptions(userId: string) {
    await ensureUserCreationRequestOptions(userId);
    const timestamp = now();

    return withTransaction(db, () => {
      return (async () => {
        await db.execute("UPDATE creation_request_options SET is_archived = 1, updated_at = ? WHERE user_id = ?", timestamp, userId);

        for (const [index, option] of configuredDefaults.creationRequestOptions.entries()) {
          await db.execute(
            `
              INSERT INTO creation_request_options (id, user_id, label, sort_order, is_archived, created_at, updated_at)
              VALUES (?, ?, ?, ?, 0, ?, ?)
            `
          , nanoid(), userId, option.label, option.sortOrder ?? index, timestamp, timestamp);
        }

        return listCreationRequestOptions(userId);
      })();
    });
  }

  async function listSkills(userId: string, { includeArchived = false }: { includeArchived?: boolean } = {}) {
    await syncInstalledSkillsFromFolder();
    const rows = await db.queryAll<SkillRow>(
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
          `,
      userId
    );
    return rows.map(toSkill);
  }

  async function defaultEnabledSkillIds() {
    const rows = await db.queryAll<SkillRow>("SELECT * FROM skills WHERE is_system = 1 AND user_id IS NULL AND is_archived = 0");
    return rows
      .map(toSkill)
      .filter((skill) => skill.defaultEnabled)
      .sort(compareSkillsForDisplay)
      .map((skill) => skill.id);
  }

  async function resolveSkillsByIds(skillIds: string[], userId: string) {
    await syncInstalledSkillsFromFolder();
    const ids = uniqueSkillIds(skillIds);
    if (ids.length === 0 || !userId) return [];
    const rows = await Promise.all(
      ids.map((id) =>
        db.queryGet<SkillRow>(
          `
            SELECT *
            FROM skills
            WHERE id = ?
              AND is_archived = 0
              AND (user_id IS NULL OR user_id = ?)
          `,
          id,
          userId
        )
      )
    );
    return rows.filter((row): row is SkillRow => Boolean(row)).map(toSkill);
  }

  async function createSkill(userId: string, input: SkillUpsert) {
    const parsed = SkillUpsertSchema.parse(input);
    const id = nanoid();
    const timestamp = now();
    await db.execute(
      `
        INSERT INTO skills (id, user_id, title, category, description, prompt, applies_to, is_system, default_enabled, default_loaded, parent_skill_id, is_archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      `
    ,
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
    return toSkill((await db.queryGet<SkillRow>("SELECT * FROM skills WHERE id = ? AND user_id = ?", id, userId))!);
  }

  async function importSkills(inputs: InstalledSkillImport[]) {
    const timestamp = now();

    return withTransaction(db, async () => {
      const imported: Skill[] = [];

      for (const input of inputs) {
        imported.push(await upsertImportedSkill(input, timestamp, { allowSystemOverwrite: false }));
      }

      return imported;
    });
  }

  async function syncInstalledSkillsFromFolder() {
    const timestamp = now();
    for (const installed of discoverInstalledSkills({ installRoot: skillInstallRoot })) {
      const existing = await db.queryGet<SkillRow>("SELECT * FROM skills WHERE id = ?", installed.skill.id);
      if (existing?.is_system) continue;
      await upsertImportedSkill(installed.skill, timestamp, { allowSystemOverwrite: false });
    }
  }

  async function upsertImportedSkill(
    input: InstalledSkillImport,
    timestamp: string,
    {
      allowSystemOverwrite
    }: {
      allowSystemOverwrite: boolean;
    }
  ) {
    const parsed = SkillUpsertSchema.parse(input);
    const existing = await db.queryGet<SkillRow>("SELECT * FROM skills WHERE id = ?", input.id);
    if (existing?.is_system && !allowSystemOverwrite) {
      throw new Error("System skills cannot be overwritten by imported skills.");
    }

    if (existing) {
      await db.execute(
        `
          UPDATE skills
          SET title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, default_enabled = ?, default_loaded = ?, parent_skill_id = ?, is_archived = ?, updated_at = ?
          WHERE id = ?
        `
      ,
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
      await db.execute(
        `
          INSERT INTO skills (id, title, category, description, prompt, applies_to, is_system, default_enabled, default_loaded, parent_skill_id, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        `
      ,
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

    return toSkill((await db.queryGet<SkillRow>("SELECT * FROM skills WHERE id = ?", input.id))!);
  }

  async function updateSkill(userId: string, skillId: string, input: Partial<SkillUpsert>) {
    const existing = await db.queryGet<SkillRow>(
      "SELECT * FROM skills WHERE id = ? AND (user_id IS NULL OR user_id = ?)",
      skillId,
      userId
    );
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
    await db.execute(
      `
        UPDATE skills
        SET title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, default_enabled = ?, default_loaded = ?, parent_skill_id = ?, is_archived = ?, updated_at = ?
        WHERE id = ? AND (user_id IS NULL OR user_id = ?)
      `
    ,
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
    return toSkill((await db.queryGet<SkillRow>("SELECT * FROM skills WHERE id = ? AND (user_id IS NULL OR user_id = ?)", skillId, userId))!);
  }

  async function saveSessionEnabledSkills(sessionId: string, userId: string, skillIds: string[], timestamp: string) {
    await syncInstalledSkillsFromFolder();
    await db.execute("DELETE FROM session_enabled_skills WHERE session_id = ?", sessionId);
    for (const skillId of uniqueSkillIds(skillIds)) {
      const exists = await db.queryGet(
        "SELECT id FROM skills WHERE id = ? AND is_archived = 0 AND (user_id IS NULL OR user_id = ?)",
        skillId,
        userId
      );
      if (!exists) continue;
      await db.execute(
        `
          INSERT INTO session_enabled_skills (session_id, skill_id, created_at)
          VALUES (?, ?, ?)
        `
      , sessionId, skillId, timestamp);
    }
  }

  async function enabledSkillsForSession(sessionId: string, userId: string) {
    const rows = await db.queryAll<SkillRow>(
      `
        SELECT skills.*
        FROM session_enabled_skills
        JOIN skills ON skills.id = session_enabled_skills.skill_id
        WHERE session_enabled_skills.session_id = ?
          AND skills.is_archived = 0
          AND (skills.user_id IS NULL OR skills.user_id = ?)
        ORDER BY session_enabled_skills.created_at, session_enabled_skills.rowid
      `,
      sessionId,
      userId
    );
    return rows.map(toSkill);
  }

  async function replaceSessionEnabledSkills(userId: string, sessionId: string, skillIds: string[]) {
    const session = await getActiveSession(userId, sessionId);
    if (!session) throw new Error("Session was not found.");
    const timestamp = now();
    return withTransaction(db, async () => {
      await saveSessionEnabledSkills(sessionId, userId, skillIds, timestamp);
      return getSessionState(userId, sessionId);
    });
  }

  async function hasUsers() {
    const row = await db.queryGet<{ count: number }>("SELECT COUNT(*) AS count FROM users");
    return Number(row?.count ?? 0) > 0;
  }

  async function createInitialAdmin(input: CreateInitialAdminInput) {
    const parsed = CreateInitialAdminSchema.parse(input);
    const passwordHash = await hashPassword(parsed.password);
    const timestamp = now();
    const id = nanoid();

    return withTransaction(db, async () => {
      if (await hasUsers()) {
        throw new Error("Initial administrator already exists.");
      }

      await db.execute(
        `
          INSERT INTO users (id, username, display_name, password_hash, role, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)
        `
      , id, parsed.username, parsed.displayName, passwordHash, timestamp, timestamp);

      return (await getUser(id))!;
    });
  }

  async function createUser(input: CreateUserInput) {
    const parsed = CreateUserSchema.parse(input);
    const passwordHash = await hashPassword(parsed.password);
    const timestamp = now();
    const id = nanoid();

    await db.execute(
      `
        INSERT INTO users (id, username, display_name, password_hash, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    , id, parsed.username, parsed.displayName, passwordHash, parsed.role, parsed.isActive ? 1 : 0, timestamp, timestamp);

    return (await getUser(id))!;
  }

  async function listUsers() {
    const rows = await db.queryAll<UserRow>("SELECT * FROM users ORDER BY created_at, rowid");
    return rows.map(toUser);
  }

  async function listUsersWithOidcIdentities() {
    const users = await listUsers();
    const identityRows = await db.queryAll<OidcIdentityRow>("SELECT * FROM user_oidc_identities ORDER BY created_at, rowid");
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

  async function getUser(userId: string) {
    const row = await db.queryGet<UserRow>("SELECT * FROM users WHERE id = ?", userId);
    return row ? toUser(row) : null;
  }

  async function getUserWithPasswordHashByUsername(username: string) {
    const row = await db.queryGet<UserRow>("SELECT * FROM users WHERE username = ?", username.trim());
    return row ? toUserWithPasswordHash(row) : null;
  }

  async function verifyPasswordLogin(username: string, password: string) {
    const parsed = CredentialsLoginSchema.parse({ username, password });
    const user = await getUserWithPasswordHashByUsername(parsed.username);
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
    const existing = await db.queryGet<UserRow>("SELECT * FROM users WHERE id = ?", userId);
    if (!existing) throw new Error("User was not found.");

    const parsed = ResetPasswordSchema.parse({ password });
    const passwordHash = await hashPassword(parsed.password);
    await db.execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", passwordHash, now(), userId);

    return (await getUser(userId))!;
  }

  async function updateUserDisplayName(userId: string, displayName: string) {
    const existing = await db.queryGet<UserRow>("SELECT * FROM users WHERE id = ?", userId);
    if (!existing) throw new Error("User was not found.");

    const parsedDisplayName = UpdateUserSchema.shape.displayName.unwrap().parse(displayName);
    await db.execute("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?", parsedDisplayName, now(), userId);
    return (await getUser(userId))!;
  }

  async function activeAdminCountExcluding(userId: string) {
    const row = await db.queryGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?",
      userId
    );
    return Number(row?.count ?? 0);
  }

  async function setUserActive(userId: string, isActive: boolean) {
    const existing = await db.queryGet<UserRow>("SELECT * FROM users WHERE id = ?", userId);
    if (!existing) throw new Error("User was not found.");

    if (
      existing.role === "admin" &&
      Boolean(existing.is_active) &&
      !isActive &&
      (await activeAdminCountExcluding(userId)) === 0
    ) {
      throw new Error("Cannot deactivate the final active administrator.");
    }

    await db.execute("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?", isActive ? 1 : 0, now(), userId);
    return (await getUser(userId))!;
  }

  async function setUserRole(userId: string, role: UserRole) {
    const parsedRole = UserRoleSchema.parse(role);
    const existing = await db.queryGet<UserRow>("SELECT * FROM users WHERE id = ?", userId);
    if (!existing) throw new Error("User was not found.");

    if (
      existing.role === "admin" &&
      Boolean(existing.is_active) &&
      parsedRole !== "admin" &&
      (await activeAdminCountExcluding(userId)) === 0
    ) {
      throw new Error("Cannot demote the final active administrator.");
    }

    await db.execute("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", parsedRole, now(), userId);
    return (await getUser(userId))!;
  }

  async function updateUser(userId: string, input: UpdateUserInput) {
    const parsed = UpdateUserSchema.parse(input);

    return withTransaction(db, async () => {
      const existing = await db.queryGet<UserRow>("SELECT * FROM users WHERE id = ?", userId);
      if (!existing) throw new Error("User was not found.");

      const nextRole = parsed.role ?? UserRoleSchema.parse(existing.role);
      const nextIsActive = parsed.isActive ?? Boolean(existing.is_active);
      if (existing.role === "admin" && Boolean(existing.is_active) && (await activeAdminCountExcluding(userId)) === 0) {
        if (!nextIsActive) {
          throw new Error("Cannot deactivate the final active administrator.");
        }
        if (nextRole !== "admin") {
          throw new Error("Cannot demote the final active administrator.");
        }
      }

      const timestamp = now();
      if (parsed.displayName !== undefined) {
        await db.execute("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?", parsed.displayName, timestamp, userId);
      }
      if (parsed.isActive !== undefined) {
        await db.execute("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?", parsed.isActive ? 1 : 0, timestamp, userId);
      }
      if (parsed.role !== undefined) {
        await db.execute("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", parsed.role, timestamp, userId);
      }

      return (await getUser(userId))!;
    });
  }

  async function bindOidcIdentity(userId: string, input: OidcIdentityUpsert) {
    const user = await getUser(userId);
    if (!user) throw new Error("User was not found.");

    const parsed = OidcIdentityUpsertSchema.parse(input);
    const existing = await db.queryGet("SELECT id FROM user_oidc_identities WHERE issuer = ? AND subject = ?", parsed.issuer, parsed.subject);
    if (existing) throw new Error("OIDC identity is already bound.");

    const id = nanoid();
    const timestamp = now();
    await db.execute(
      `
        INSERT INTO user_oidc_identities (id, user_id, issuer, subject, email, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    , id, userId, parsed.issuer, parsed.subject, parsed.email, parsed.name, timestamp, timestamp);

    return toOidcIdentity((await db.queryGet<OidcIdentityRow>("SELECT * FROM user_oidc_identities WHERE id = ?", id))!);
  }

  async function deleteOidcIdentity(identityId: string) {
    await db.execute("DELETE FROM user_oidc_identities WHERE id = ?", identityId);
  }

  async function deleteOidcIdentityForUser(userId: string, identityId: string) {
    const result = await db.execute("DELETE FROM user_oidc_identities WHERE id = ? AND user_id = ?", identityId, userId);
    if (result.changes === 0) throw new Error("OIDC identity was not found.");
  }

  async function findUserByOidcIdentity(issuer: string, subject: string) {
    const row = await db.queryGet<UserRow>(
      `
        SELECT users.*
        FROM user_oidc_identities
        JOIN users ON users.id = user_oidc_identities.user_id
        WHERE user_oidc_identities.issuer = ? AND user_oidc_identities.subject = ? AND users.is_active = 1
      `,
      issuer.trim(),
      subject.trim()
    );

    return row ? toUser(row) : null;
  }

  async function getRootMemory(userId: string) {
    const row = await db.queryGet<RootMemoryRow>(
      `
        SELECT *
        FROM root_memory
        WHERE user_id = ?
        ORDER BY updated_at DESC, created_at DESC, rowid DESC
        LIMIT 1
      `,
      userId
    );
    return row ? toRootMemory(row) : null;
  }

  async function saveRootMemory(userId: string, preferences: RootPreferences) {
    const parsed = RootPreferencesSchema.parse(preferences);
    const existing = await getRootMemory(userId);
    const id = nanoid();
    const timestamp = now();
    const summary = summarizePreferences(parsed);

    await db.execute(
      `
        INSERT INTO root_memory (id, user_id, preferences_json, summary, learned_summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    , id, userId, JSON.stringify(parsed), summary, existing?.learnedSummary ?? "", timestamp, timestamp);

    const row = await db.queryGet<RootMemoryRow>("SELECT * FROM root_memory WHERE id = ? AND user_id = ?", id, userId);
    if (!row) throw new Error("Failed to save root memory.");
    return toRootMemory(row);
  }

  async function requireOwnedRootMemory(userId: string, rootMemoryId: string) {
    const rootRow = await db.queryGet<RootMemoryRow>("SELECT * FROM root_memory WHERE id = ? AND user_id = ?", rootMemoryId, userId);
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

  async function insertArtifact({
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
    await db.execute(
      `
        INSERT INTO artifacts (id, session_id, node_id, type, version, payload_json, source_artifact_ids_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    , artifactId, sessionId, nodeId, type, 1, JSON.stringify(parsedPayload), JSON.stringify(sourceArtifactIds), timestamp, timestamp);
    return artifactId;
  }

  async function createWorkflowNodeWithOptionalArtifact({
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

    return withTransaction(db, async () => {
      if (parent) {
        await saveNodeSelection(sessionId, parent.node.id, parent.options, parent.selectedOptionId, timestamp);
      } else {
        await db.execute(
          `
            INSERT INTO sessions (id, user_id, root_memory_id, artifact_type_id, title, status, current_node_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        , sessionId, userId, rootMemoryId, artifactTypeId, resolvedSessionTitle, "active", nodeId, timestamp, timestamp);
      }

      await db.execute(
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
      ,
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
        ? await insertArtifact({
            sessionId,
            nodeId,
            type: artifact.type,
            payload: artifact.payload,
            sourceArtifactIds,
            timestamp
          })
        : null;

      await db.execute(
        `
          UPDATE tree_nodes
          SET produced_artifact_id = ?
          WHERE id = ?
        `
      , artifactId, nodeId);

      if (parent) {
        await db.execute(
          `
            UPDATE sessions
            SET current_node_id = ?, title = ?, status = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
          `
        , nodeId, resolvedSessionTitle, "active", timestamp, sessionId, userId);
      } else {
        await saveSessionEnabledSkills(sessionId, userId, enabledSkillIds ?? (await defaultEnabledSkillIds()), timestamp);
      }

      const state = await getSessionState(userId, sessionId);
      if (!state) {
        throw new Error("Failed to create workflow node state.");
      }
      return state;
    });
  }

  async function createSession({ userId, enabledSkillIds, rootMemoryId }: { userId: string; enabledSkillIds?: string[]; rootMemoryId: string }) {
    const root = await requireOwnedRootMemory(userId, rootMemoryId);
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

  async function createArtifactChild(input: {
    artifact: { type: string; payload: unknown; sourceArtifactIds?: string[] } | null;
    customOption?: BranchOption;
    optionMode?: OptionGenerationMode;
    roundIntent?: string;
    selectedOptionId: BranchOption["id"];
    sessionId: string;
    nodeId: string;
    userId: string;
  }): Promise<SessionState> {
    const session = await getActiveSession(input.userId, input.sessionId);
    if (!session) {
      throw new Error("Session was not found.");
    }

    const current = await db.queryGet<TreeNodeRow>("SELECT * FROM tree_nodes WHERE id = ?", input.nodeId);
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

  async function updateNodeArtifact(input: {
    agentMessages?: AgentMessage[];
    artifact: { type: string; payload: unknown; sourceArtifactIds?: string[] } | null;
    nodeId: string;
    roundIntent: string;
    sessionId: string;
    userId: string;
  }): Promise<SessionState> {
    const session = await getActiveSession(input.userId, input.sessionId);
    if (!session) {
      throw new Error("Session was not found.");
    }
    const target = await db.queryGet<TreeNodeRow>("SELECT * FROM tree_nodes WHERE id = ?", input.nodeId);
    if (!target || target.session_id !== input.sessionId) {
      throw new Error("Tree node was not found.");
    }

    const timestamp = now();
    const sourceArtifactIds = input.artifact?.sourceArtifactIds ?? [];
    const agentMessagesJson = appendAgentMessagesJson(target.agent_messages_json, input.agentMessages);
    const title = artifactTreeTitle(input.artifact) ?? session.title;

    return withTransaction(db, async () => {
      const artifactId = input.artifact
        ? await insertArtifact({
            sessionId: input.sessionId,
            nodeId: input.nodeId,
            type: input.artifact.type,
            payload: input.artifact.payload,
            sourceArtifactIds,
            timestamp
          })
        : null;

      await db.execute(
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
      ,
        input.roundIntent,
        input.artifact ? "artifact" : "analysis",
        artifactId,
        JSON.stringify(sourceArtifactIds),
        agentMessagesJson,
        timestamp,
        input.nodeId
      );

      await db.execute(
        `
          UPDATE sessions
          SET title = ?, status = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      , title, "active", timestamp, input.sessionId, input.userId);

      const state = await getSessionState(input.userId, input.sessionId);
      if (!state) {
        throw new Error("Failed to update node artifact.");
      }
      return state;
    });
  }

  async function updateNodeOptions({
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
    const session = await getActiveSession(userId, sessionId);
    if (!session) {
      throw new Error("Session was not found.");
    }
    const target = await db.queryGet<TreeNodeRow>("SELECT * FROM tree_nodes WHERE id = ?", nodeId);
    if (!target || target.session_id !== sessionId) {
      throw new Error("Tree node was not found.");
    }

    const timestamp = now();
    const agentMessagesJson = appendAgentMessagesJson(target.agent_messages_json, agentMessages);

    return withTransaction(db, async () => {
      await db.execute(
        `
          UPDATE tree_nodes
          SET round_intent = ?, options_json = ?, agent_messages_json = ?, updated_at = ?
          WHERE id = ?
        `
      , output.roundIntent, JSON.stringify(output.options), agentMessagesJson, timestamp, nodeId);

      await db.execute(
        `
          UPDATE sessions
          SET updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      , timestamp, sessionId, userId);

      const state = await getSessionState(userId, sessionId);
      if (!state) {
        throw new Error("Failed to update session options.");
      }
      return state;
    });
  }

  async function completeNode({
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
    const session = await getActiveSession(userId, sessionId);
    if (!session) {
      throw new Error("Session was not found.");
    }
    const target = await db.queryGet<TreeNodeRow>("SELECT * FROM tree_nodes WHERE id = ?", nodeId);
    if (!target || target.session_id !== sessionId) {
      throw new Error("Tree node was not found.");
    }

    const timestamp = now();
    const sourceArtifactIds = artifact?.sourceArtifactIds ?? [];
    const agentMessagesJson = appendAgentMessagesJson(target.agent_messages_json, agentMessages);
    const title = artifactTreeTitle(artifact) ?? session.title;

    return withTransaction(db, async () => {
      const artifactId = artifact
        ? await insertArtifact({
            sessionId,
            nodeId,
            type: artifact.type,
            payload: artifact.payload,
            sourceArtifactIds,
            timestamp
          })
        : null;

      await db.execute(
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
      ,
        output.roundIntent,
        artifact ? "artifact" : "analysis",
        artifactId,
        JSON.stringify(sourceArtifactIds),
        agentMessagesJson,
        timestamp,
        nodeId
      );

      await db.execute(
        `
          UPDATE sessions
          SET title = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      , title, timestamp, sessionId, userId);

      const state = await getSessionState(userId, sessionId);
      if (!state) {
        throw new Error("Failed to complete tree node.");
      }
      return state;
    });
  }

  async function activateHistoricalBranch({
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
    const session = await getActiveSession(userId, sessionId);
    if (!session) {
      throw new Error("Session was not found.");
    }
    const parent = await getNodeForSelection(sessionId, nodeId);

    const existingChild = await db.queryGet<TreeNodeRow>(
      `
        SELECT *
        FROM tree_nodes
        WHERE session_id = ? AND parent_id = ? AND parent_option_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `,
      sessionId,
      nodeId,
      selectedOptionId
    );
    if (!existingChild) return null;

    const selectedOptions = optionsWithSelection(parent, selectedOptionId);
    const timestamp = now();
    return withTransaction(db, async () => {
      await saveNodeSelection(sessionId, nodeId, selectedOptions, selectedOptionId, timestamp);
      const artifact = existingChild.produced_artifact_id
        ? await db.queryGet<ArtifactRow>("SELECT * FROM artifacts WHERE id = ?", existingChild.produced_artifact_id)
        : undefined;
      await db.execute(
        `
          UPDATE sessions
          SET current_node_id = ?, title = ?, status = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      , existingChild.id, artifactExcerpt(artifact) || session.title, "active", timestamp, sessionId, userId);

      return getSessionState(userId, sessionId);
    });
  }

  async function getNodeForSelection(sessionId: string, nodeId: string) {
    const row = await db.queryGet<TreeNodeRow>("SELECT * FROM tree_nodes WHERE id = ?", nodeId);
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

  async function saveNodeSelection(
    sessionId: string,
    nodeId: string,
    options: BranchOption[],
    selectedOptionId: BranchOption["id"],
    timestamp: string
  ) {
    const folded = options.filter((option) => option.id !== selectedOptionId);
    await db.execute(
      `
        UPDATE tree_nodes
        SET options_json = ?, selected_option_id = ?, folded_options_json = ?, updated_at = ?
        WHERE id = ?
      `
    , JSON.stringify(options), selectedOptionId, JSON.stringify(folded), timestamp, nodeId);
    await db.execute("DELETE FROM branch_history WHERE session_id = ? AND node_id = ?", sessionId, nodeId);
    for (const option of folded) {
      await db.execute(
        `
          INSERT INTO branch_history (id, session_id, node_id, option_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
      , nanoid(), sessionId, nodeId, JSON.stringify(option), timestamp);
    }
  }

  async function getActiveSession(userId: string, sessionId: string) {
    return db.queryGet<SessionRow>("SELECT * FROM sessions WHERE id = ? AND user_id = ? AND is_archived = 0", sessionId, userId);
  }

  async function toWorkSummary(row: WorkSummaryRow): Promise<WorkSummary> {
    const artifactRow = row.latest_artifact_id
      ? await db.queryGet<ArtifactRow>("SELECT * FROM artifacts WHERE id = ?", row.latest_artifact_id)
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

  async function getSessionSummary(userId: string, sessionId: string) {
    const row = await db.queryGet<WorkSummaryRow>(
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
      `,
      sessionId,
      userId
    );

    return row ? toWorkSummary(row) : null;
  }

  async function listSessionSummaries(userId: string, { archived = false }: { archived?: boolean } = {}) {
    const rows = await db.queryAll<WorkSummaryRow>(
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
      `,
      userId,
      archived ? 1 : 0
    );

    return Promise.all(rows.map(toWorkSummary));
  }

  async function renameSession(userId: string, sessionId: string, title: string) {
    const timestamp = now();
    const result = await db.execute(
      "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ? AND is_archived = 0",
      title,
      timestamp,
      sessionId,
      userId
    );
    return result.changes > 0 ? getSessionSummary(userId, sessionId) : null;
  }

  async function archiveSession(userId: string, sessionId: string) {
    const timestamp = now();
    const result = await db.execute(
      "UPDATE sessions SET is_archived = 1, updated_at = ? WHERE id = ? AND user_id = ? AND is_archived = 0",
      timestamp,
      sessionId,
      userId
    );
    return result.changes > 0 ? getSessionSummary(userId, sessionId) : null;
  }

  async function getSessionState(userId: string, sessionId: string): Promise<SessionState | null> {
    const session = await getActiveSession(userId, sessionId);
    if (!session) return null;

    const root = await db.queryGet<RootMemoryRow>("SELECT * FROM root_memory WHERE id = ? AND user_id = ?", session.root_memory_id, userId);
    if (!root) return null;

    const nodes = (await db.queryAll<TreeNodeRow>("SELECT * FROM tree_nodes WHERE session_id = ?", sessionId))
      .map(toNode)
      .sort((a, b) => a.roundIndex - b.roundIndex);
    const artifactRows = await db.queryAll<ArtifactRow>(
      "SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at ASC, rowid ASC",
      sessionId
    );
    const artifacts = artifactRows.map(toArtifact);
    const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const currentNode = session.current_node_id ? nodes.find((node) => node.id === session.current_node_id) ?? null : null;
    const currentArtifact = currentNode?.producedArtifactId ? artifactById.get(currentNode.producedArtifactId) ?? null : null;
    const nodeArtifacts = nodes.flatMap((node) => {
      const artifact = node.producedArtifactId ? artifactById.get(node.producedArtifactId) : null;
      return artifact ? [{ nodeId: node.id, artifact }] : [];
    });
    const historyRows = await db.queryAll<BranchHistoryRow>("SELECT * FROM branch_history WHERE session_id = ?", sessionId);
    const selectedPath = activePathFor(nodes, currentNode);
    const enabledSkills = await enabledSkillsForSession(sessionId, userId);

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

  async function getLatestSessionState(userId: string): Promise<SessionState | null> {
    const row = await db.queryGet<{ id: string }>(
      "SELECT id FROM sessions WHERE user_id = ? AND is_archived = 0 ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1",
      userId
    );

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

type TritreeRepository = Awaited<ReturnType<typeof createTritreeRepository>>;

let repositoryInstance: Promise<TritreeRepository> | null = null;

export function getRepository() {
  repositoryInstance ??= createTritreeRepository();
  return repositoryInstance;
}

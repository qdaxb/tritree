import { nanoid } from "nanoid";
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
  type CreationRequestOption,
  type CreationRequestOptionUpsert,
  type DirectorDraftOutput,
  type DirectorOptionsOutput,
  type DirectorOutput,
  type Draft,
  type OptionGenerationMode,
  type RootMemory,
  type RootPreferences,
  type Skill,
  type SkillUpsert,
  type SessionState,
  type TreeNode,
  BranchOptionSchema,
  CUSTOM_EDIT_OPTION,
  CUSTOM_OPTION_ID_PREFIX,
  CreationRequestOptionSchema,
  CreationRequestOptionUpsertSchema,
  DEFAULT_CREATION_REQUEST_OPTIONS,
  DEFAULT_SYSTEM_SKILLS,
  DraftSchema,
  RootPreferencesSchema,
  SessionStateSchema,
  SessionStatusSchema,
  SkillSchema,
  SkillUpsertSchema,
  TreeNodeSchema,
  requireThreeOptions
} from "@/lib/domain";
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
  title: string;
  status: string;
  current_node_id: string | null;
  created_at: string;
  updated_at: string;
};

type TreeNodeRow = {
  id: string;
  session_id: string;
  parent_id: string | null;
  parent_option_id: string | null;
  round_index: number;
  round_intent: string;
  options_json: string;
  selected_option_id: string | null;
  folded_options_json: string;
  created_at: string;
};

type DraftVersionRow = {
  id: string;
  session_id: string;
  node_id: string;
  round_index: number;
  title: string;
  body: string;
  hashtags_json: string;
  image_prompt: string;
  created_at: string;
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
  is_system: number;
  default_enabled: number;
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

const OLD_CREATION_REQUEST_OPTION_ORDER = [
  "default-preserve-my-meaning",
  "default-dont-expand-much",
  "default-first-time-reader",
  "default-friend-tone",
  "default-english",
  "default-no-ad-tone",
  "default-experienced-reader",
  "default-moments",
  "default-short-version"
];

function now() {
  return new Date().toISOString();
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
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
  const seed = preferences.seed?.trim();
  const creationRequest = preferences.creationRequest?.trim();
  const requestParts = [creationRequest ? `本次创作要求：${creationRequest}` : ""].filter(Boolean);

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
    roundIndex: row.round_index,
    roundIntent: row.round_intent,
    options,
    selectedOptionId: row.selected_option_id as BranchOption["id"] | null,
    foldedOptions,
    createdAt: row.created_at
  });
}

function toDraft(row: DraftVersionRow): Draft {
  return DraftSchema.parse({
    title: row.title,
    body: row.body,
    hashtags: parseJson<string[]>(row.hashtags_json),
    imagePrompt: row.image_prompt
  });
}

function toSkill(row: SkillRow): Skill {
  return SkillSchema.parse({
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    prompt: row.prompt,
    appliesTo: row.applies_to || "both",
    isSystem: Boolean(row.is_system),
    defaultEnabled: Boolean(row.default_enabled),
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

function latestDraftForNode(draftsByNode: Map<string, DraftVersionRow>, nodeId: string | null) {
  if (!nodeId) return null;
  const row = draftsByNode.get(nodeId);
  return row ? toDraft(row) : null;
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

export function createTreeableRepository(dbPath = defaultDbPath()) {
  const db = createDatabase(dbPath);
  ensureSystemSkills();
  ensureDefaultCreationRequestOptions();

  function ensureSystemSkills() {
    const timestamp = now();
    for (const skill of DEFAULT_SYSTEM_SKILLS) {
      const parsed = SkillUpsertSchema.parse(skill);
      const existing = db.prepare("SELECT id FROM skills WHERE id = ?").get(skill.id);
      if (existing) {
        db.prepare(
          `
            UPDATE skills
            SET title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, is_system = 1, default_enabled = ?, is_archived = ?, updated_at = ?
            WHERE id = ?
          `
        ).run(
          parsed.title,
          parsed.category,
          parsed.description,
          parsed.prompt,
          parsed.appliesTo,
          parsed.defaultEnabled ? 1 : 0,
          parsed.isArchived ? 1 : 0,
          timestamp,
          skill.id
        );
      } else {
        db.prepare(
          `
            INSERT INTO skills (id, title, category, description, prompt, applies_to, is_system, default_enabled, is_archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
          `
        ).run(
          skill.id,
          parsed.title,
          parsed.category,
          parsed.description,
          parsed.prompt,
          parsed.appliesTo,
          parsed.defaultEnabled ? 1 : 0,
          parsed.isArchived ? 1 : 0,
          timestamp,
          timestamp
        );
      }
    }
  }

  function ensureDefaultCreationRequestOptions() {
    const timestamp = now();

    DEFAULT_CREATION_REQUEST_OPTIONS.forEach((option, index) => {
      const existing = db.prepare("SELECT * FROM creation_request_options WHERE id = ?").get(option.id) as
        | CreationRequestOptionRow
        | undefined;
      if (existing) {
        const legacyDefaultLabels: Record<string, string> = {
          "default-first-time-reader": "写给第一次接触的人",
          "default-moments": "适合发朋友圈"
        };

        if (existing.label === legacyDefaultLabels[option.id]) {
          db.prepare(
            `
              UPDATE creation_request_options
              SET label = ?, updated_at = ?
              WHERE id = ?
            `
          ).run(option.label, timestamp, option.id);
        }
        return;
      }

      db.prepare(
        `
          INSERT INTO creation_request_options (id, label, sort_order, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, 0, ?, ?)
        `
      ).run(option.id, option.label, index, timestamp, timestamp);
    });
    migrateDefaultCreationRequestOptionOrderIfUntouched(timestamp);
  }

  function migrateDefaultCreationRequestOptionOrderIfUntouched(timestamp: string) {
    const defaultIds = DEFAULT_CREATION_REQUEST_OPTIONS.map((option) => option.id);
    const placeholders = defaultIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `
          SELECT id, is_archived
          FROM creation_request_options
          WHERE id IN (${placeholders})
          ORDER BY sort_order, created_at, rowid
        `
      )
      .all(...defaultIds) as Array<Pick<CreationRequestOptionRow, "id" | "is_archived">>;

    if (rows.length !== defaultIds.length || rows.some((row) => Boolean(row.is_archived))) return;
    const currentDefaultOrder = rows.map((row) => row.id);
    if (currentDefaultOrder.join("|") !== OLD_CREATION_REQUEST_OPTION_ORDER.join("|")) return;

    const updateSortOrder = db.prepare("UPDATE creation_request_options SET sort_order = ?, updated_at = ? WHERE id = ?");
    DEFAULT_CREATION_REQUEST_OPTIONS.forEach((option, index) => {
      updateSortOrder.run(index, timestamp, option.id);
    });
  }

  function ensureUserCreationRequestOptions(userId: string) {
    const row = db
      .prepare("SELECT id FROM creation_request_options WHERE user_id = ? LIMIT 1")
      .get(userId);
    if (row) return;

    const timestamp = now();
    DEFAULT_CREATION_REQUEST_OPTIONS.forEach((option, index) => {
      db.prepare(
        `
          INSERT INTO creation_request_options (id, user_id, label, sort_order, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)
        `
      ).run(nanoid(), userId, option.label, index, timestamp, timestamp);
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

      DEFAULT_CREATION_REQUEST_OPTIONS.forEach((option, index) => {
        db.prepare(
          `
            INSERT INTO creation_request_options (id, user_id, label, sort_order, is_archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
          `
        ).run(nanoid(), userId, option.label, index, timestamp, timestamp);
      });

      return listCreationRequestOptions(userId);
    });
  }

  function listSkills(userId: string, { includeArchived = false }: { includeArchived?: boolean } = {}) {
    const rows = db
      .prepare(
        includeArchived
          ? `
              SELECT *
              FROM skills
              WHERE (is_system = 1 AND user_id IS NULL) OR user_id = ?
              ORDER BY is_system DESC, category, title
            `
          : `
              SELECT *
              FROM skills
              WHERE ((is_system = 1 AND user_id IS NULL) OR user_id = ?) AND is_archived = 0
              ORDER BY is_system DESC, category, title
            `
      )
      .all(userId) as SkillRow[];
    return rows.map(toSkill);
  }

  function defaultEnabledSkillIds() {
    const rows = db
      .prepare("SELECT * FROM skills WHERE is_system = 1 AND user_id IS NULL AND is_archived = 0 ORDER BY category, title")
      .all() as SkillRow[];
    return rows
      .map(toSkill)
      .filter((skill) => skill.defaultEnabled)
      .map((skill) => skill.id);
  }

  function resolveSkillsByIds(skillIds: string[], userId: string) {
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
                AND ((is_system = 1 AND user_id IS NULL) OR user_id = ?)
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
        INSERT INTO skills (id, user_id, title, category, description, prompt, applies_to, is_system, default_enabled, is_archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
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
      parsed.isArchived ? 1 : 0,
      timestamp,
      timestamp
    );
    return toSkill(db.prepare("SELECT * FROM skills WHERE id = ? AND user_id = ?").get(id, userId) as SkillRow);
  }

  function updateSkill(userId: string, skillId: string, input: Partial<SkillUpsert>) {
    const existing = db
      .prepare("SELECT * FROM skills WHERE id = ? AND ((is_system = 1 AND user_id IS NULL) OR user_id = ?)")
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
      isArchived: input.isArchived ?? Boolean(existing.is_archived)
    });
    const timestamp = now();
    db.prepare(
      `
        UPDATE skills
        SET title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, default_enabled = ?, is_archived = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `
    ).run(
      parsed.title,
      parsed.category,
      parsed.description,
      parsed.prompt,
      parsed.appliesTo,
      parsed.defaultEnabled ? 1 : 0,
      parsed.isArchived ? 1 : 0,
      timestamp,
      skillId,
      userId
    );
    return toSkill(db.prepare("SELECT * FROM skills WHERE id = ? AND user_id = ?").get(skillId, userId) as SkillRow);
  }

  function saveSessionEnabledSkills(sessionId: string, userId: string, skillIds: string[], timestamp: string) {
    db.prepare("DELETE FROM session_enabled_skills WHERE session_id = ?").run(sessionId);
    for (const skillId of uniqueSkillIds(skillIds)) {
      const exists = db
        .prepare(
          "SELECT id FROM skills WHERE id = ? AND is_archived = 0 AND ((is_system = 1 AND user_id IS NULL) OR user_id = ?)"
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
            AND ((skills.is_system = 1 AND skills.user_id IS NULL) OR skills.user_id = ?)
          ORDER BY session_enabled_skills.created_at, session_enabled_skills.rowid
        `
      )
      .all(sessionId, userId) as SkillRow[];
    return rows.map(toSkill);
  }

  function replaceSessionEnabledSkills(userId: string, sessionId: string, skillIds: string[]) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as SessionRow | undefined;
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
    const row = db.prepare("SELECT * FROM root_memory WHERE user_id = ? LIMIT 1").get(userId) as RootMemoryRow | undefined;
    return row ? toRootMemory(row) : null;
  }

  function saveRootMemory(userId: string, preferences: RootPreferences) {
    const parsed = RootPreferencesSchema.parse(preferences);
    const existing = getRootMemory(userId);
    const id = existing?.id ?? nanoid();
    const timestamp = now();
    const summary = summarizePreferences(parsed);

    if (existing) {
      db.prepare(
        `
          UPDATE root_memory
          SET preferences_json = ?, summary = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      ).run(JSON.stringify(parsed), summary, timestamp, id, userId);
    } else {
      db.prepare(
        `
          INSERT INTO root_memory (id, user_id, preferences_json, summary, learned_summary, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      ).run(id, userId, JSON.stringify(parsed), summary, "", timestamp, timestamp);
    }

    return getRootMemory(userId)!;
  }

  function createSessionDraft({
    userId,
    enabledSkillIds,
    rootMemoryId,
    draft,
    roundIntent = "种子念头"
  }: {
    userId: string;
    enabledSkillIds?: string[];
    rootMemoryId: string;
    draft: Draft;
    roundIntent?: string;
  }) {
    const sessionId = nanoid();
    const nodeId = nanoid();
    const draftId = nanoid();
    const timestamp = now();
    const parsedDraft = DraftSchema.parse(draft);

    return withTransaction(db, () => {
      const root = db.prepare("SELECT id FROM root_memory WHERE id = ? AND user_id = ?").get(rootMemoryId, userId);
      if (!root) throw new Error("Root memory was not found.");

      db.prepare(
        `
          INSERT INTO sessions (id, user_id, root_memory_id, title, status, current_node_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(sessionId, userId, rootMemoryId, parsedDraft.title || "Untitled Tree", "active", nodeId, timestamp, timestamp);

      db.prepare(
        `
          INSERT INTO tree_nodes (
            id,
            session_id,
            parent_id,
            parent_option_id,
            round_index,
            round_intent,
            options_json,
            selected_option_id,
            folded_options_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        nodeId,
        sessionId,
        null,
        null,
        1,
        roundIntent,
        "[]",
        null,
        "[]",
        timestamp
      );

      db.prepare(
        `
          INSERT INTO draft_versions (id, session_id, node_id, round_index, title, body, hashtags_json, image_prompt, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        draftId,
        sessionId,
        nodeId,
        1,
        parsedDraft.title,
        parsedDraft.body,
        JSON.stringify(parsedDraft.hashtags),
        parsedDraft.imagePrompt,
        timestamp
      );

      saveSessionEnabledSkills(sessionId, userId, enabledSkillIds ?? defaultEnabledSkillIds(), timestamp);

      const state = getSessionState(userId, sessionId);
      if (!state) {
        throw new Error("Failed to create session draft state.");
      }
      return state;
    });
  }

  function createDraftChild({
    userId,
    customOption,
    draft,
    optionMode = "balanced",
    roundIntent,
    sessionId,
    nodeId,
    selectedOptionId
  }: {
    userId: string;
    customOption?: BranchOption;
    draft?: Draft;
    optionMode?: OptionGenerationMode;
    roundIntent?: string;
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
  }) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as SessionRow | undefined;
    if (!session) {
      throw new Error("Session was not found.");
    }

    const current = db.prepare("SELECT * FROM tree_nodes WHERE id = ?").get(nodeId) as TreeNodeRow | undefined;
    if (!current || current.session_id !== sessionId) {
      throw new Error("Parent tree node was not found.");
    }

    const parentNode = toNode(current);
    const parsedDraft = draft ? DraftSchema.parse(draft) : null;
    const parsedCustomOption = customOption ? BranchOptionSchema.parse(customOption) : null;
    if (parsedCustomOption && parsedCustomOption.id !== selectedOptionId) {
      throw new Error("Custom option must match the selected option.");
    }
    const optionsWithCustom = parsedCustomOption
      ? [...parentNode.options.filter((option) => option.id !== parsedCustomOption.id), parsedCustomOption]
      : parentNode.options;
    const parentOptions = optionsWithCustom.map((option) =>
      option.id === selectedOptionId && optionMode ? { ...option, mode: optionMode } : option
    );
    const selected = parentOptions.find((option) => option.id === selectedOptionId);
    if (!selected) {
      throw new Error("Selected option is not part of the parent node.");
    }

    const nextNodeId = nanoid();
    const nextRoundIndex = parentNode.roundIndex + 1;
    const timestamp = now();

    return withTransaction(db, () => {
      saveNodeSelection(sessionId, nodeId, parentOptions, selectedOptionId, timestamp);

      db.prepare(
        `
          INSERT INTO tree_nodes (
            id,
            session_id,
            parent_id,
            parent_option_id,
            round_index,
            round_intent,
            options_json,
            selected_option_id,
            folded_options_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        nextNodeId,
        sessionId,
        nodeId,
        selectedOptionId,
        nextRoundIndex,
        roundIntent ?? selected.label,
        "[]",
        null,
        "[]",
        timestamp
      );

      if (parsedDraft) {
        db.prepare(
          `
            INSERT INTO draft_versions (id, session_id, node_id, round_index, title, body, hashtags_json, image_prompt, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        ).run(
          nanoid(),
          sessionId,
          nextNodeId,
          nextRoundIndex,
          parsedDraft.title,
          parsedDraft.body,
          JSON.stringify(parsedDraft.hashtags),
          parsedDraft.imagePrompt,
          timestamp
        );
      }

      db.prepare(
        `
          UPDATE sessions
          SET current_node_id = ?, title = ?, status = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      ).run(nextNodeId, parsedDraft?.title || session.title || "Untitled Tree", "active", timestamp, sessionId, userId);

      const state = getSessionState(userId, sessionId);
      if (!state) {
        throw new Error("Failed to create draft child state.");
      }
      return state;
    });
  }

  function createEditedDraftChild({
    userId,
    sessionId,
    nodeId,
    draft,
    output
  }: {
    userId: string;
    sessionId: string;
    nodeId: string;
    draft: Draft;
    output?: DirectorOptionsOutput;
  }) {
    const parsedDraft = DraftSchema.parse(draft);
    const customEditOption = BranchOptionSchema.parse({
      ...CUSTOM_EDIT_OPTION,
      id: `${CUSTOM_OPTION_ID_PREFIX}edit-${nanoid()}`
    });

    const draftState = createDraftChild({
      userId,
      customOption: customEditOption,
      draft: parsedDraft,
      optionMode: "balanced",
      roundIntent: output?.roundIntent ?? customEditOption.label,
      sessionId,
      nodeId,
      selectedOptionId: customEditOption.id
    });

    if (!output) return draftState;

    return updateNodeOptions({
      userId,
      sessionId,
      nodeId: draftState.currentNode!.id,
      output
    });
  }

  function updateCurrentNodeDraftAndOptions({
    userId,
    sessionId,
    nodeId,
    draft,
    output
  }: {
    userId: string;
    sessionId: string;
    nodeId: string;
    draft: Draft;
    output: DirectorOutput;
  }) {
    requireThreeOptions(output.options);
    const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as SessionRow | undefined;
    if (!session) {
      throw new Error("Session was not found.");
    }
    if (session.current_node_id !== nodeId) {
      throw new Error("Edited node is not the active node.");
    }

    return createEditedDraftChild({
      userId,
      sessionId,
      nodeId,
      draft,
      output: {
        roundIntent: output.roundIntent,
        options: output.options,
        memoryObservation: output.memoryObservation
      }
    });
  }

  function updateNodeDraft({
    userId,
    sessionId,
    nodeId,
    output
  }: {
    userId: string;
    sessionId: string;
    nodeId: string;
    output: DirectorDraftOutput;
  }) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as SessionRow | undefined;
    if (!session) {
      throw new Error("Session was not found.");
    }
    const target = db.prepare("SELECT * FROM tree_nodes WHERE id = ?").get(nodeId) as TreeNodeRow | undefined;
    if (!target || target.session_id !== sessionId) {
      throw new Error("Tree node was not found.");
    }

    const parsedDraft = DraftSchema.parse(output.draft);
    const timestamp = now();

    return withTransaction(db, () => {
      db.prepare(
        `
          UPDATE tree_nodes
          SET round_intent = ?
          WHERE id = ?
        `
      ).run(output.roundIntent, nodeId);

      db.prepare(
        `
          INSERT INTO draft_versions (id, session_id, node_id, round_index, title, body, hashtags_json, image_prompt, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        nanoid(),
        sessionId,
        nodeId,
        target.round_index,
        parsedDraft.title,
        parsedDraft.body,
        JSON.stringify(parsedDraft.hashtags),
        parsedDraft.imagePrompt,
        timestamp
      );

      db.prepare(
        `
          UPDATE sessions
          SET title = ?, status = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      ).run(parsedDraft.title || session.title || "Untitled Tree", "active", timestamp, sessionId, userId);

      const state = getSessionState(userId, sessionId);
      if (!state) {
        throw new Error("Failed to update node draft.");
      }
      return state;
    });
  }

  function updateNodeOptions({
    userId,
    sessionId,
    nodeId,
    output
  }: {
    userId: string;
    sessionId: string;
    nodeId: string;
    output: DirectorOptionsOutput;
  }) {
    requireThreeOptions(output.options);
    const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as SessionRow | undefined;
    if (!session) {
      throw new Error("Session was not found.");
    }
    const target = db.prepare("SELECT * FROM tree_nodes WHERE id = ?").get(nodeId) as TreeNodeRow | undefined;
    if (!target || target.session_id !== sessionId) {
      throw new Error("Tree node was not found.");
    }

    const timestamp = now();

    return withTransaction(db, () => {
      db.prepare(
        `
          UPDATE tree_nodes
          SET round_intent = ?, options_json = ?
          WHERE id = ?
        `
      ).run(output.roundIntent, JSON.stringify(output.options), nodeId);

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
    const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as SessionRow | undefined;
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
      const draft = latestDraftForNode(latestDraftRowsByNode(sessionId), existingChild.id);
      db.prepare(
        `
          UPDATE sessions
          SET current_node_id = ?, title = ?, status = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      ).run(existingChild.id, draft?.title || session.title, "active", timestamp, sessionId, userId);

      return getSessionState(userId, sessionId);
    });
  }

  function createHistoricalDraftChild({
    userId,
    customOption,
    optionMode = "balanced",
    sessionId,
    nodeId,
    selectedOptionId
  }: {
    userId: string;
    customOption?: BranchOption;
    optionMode?: OptionGenerationMode;
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
  }) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as SessionRow | undefined;
    if (!session) {
      throw new Error("Session was not found.");
    }

    const parent = getNodeForSelection(sessionId, nodeId);
    const parsedCustomOption = customOption ? BranchOptionSchema.parse(customOption) : null;
    if (parsedCustomOption && parsedCustomOption.id !== selectedOptionId) {
      throw new Error("Custom option must match the selected option.");
    }
    const parentOptions = parsedCustomOption
      ? [...parent.options.filter((option) => option.id !== parsedCustomOption.id), parsedCustomOption]
      : parent.options;
    const selectedOptions = optionsWithSelection({ ...parent, options: parentOptions }, selectedOptionId, optionMode);
    const selected = selectedOptions.find((option) => option.id === selectedOptionId)!;
    const timestamp = now();

    return withTransaction(db, () => {
      saveNodeSelection(sessionId, nodeId, selectedOptions, selectedOptionId, timestamp);

      const nextNodeId = nanoid();
      const nextRoundIndex = parent.roundIndex + 1;

      db.prepare(
        `
          INSERT INTO tree_nodes (
            id,
            session_id,
            parent_id,
            parent_option_id,
            round_index,
            round_intent,
            options_json,
            selected_option_id,
            folded_options_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        nextNodeId,
        sessionId,
        nodeId,
        selectedOptionId,
        nextRoundIndex,
        selected.label,
        "[]",
        null,
        "[]",
        timestamp
      );

      db.prepare(
        `
          UPDATE sessions
          SET current_node_id = ?, status = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `
      ).run(nextNodeId, "active", timestamp, sessionId, userId);

      const state = getSessionState(userId, sessionId);
      if (!state) {
        throw new Error("Failed to create historical draft child state.");
      }
      return state;
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
        SET options_json = ?, selected_option_id = ?, folded_options_json = ?
        WHERE id = ?
      `
    ).run(JSON.stringify(options), selectedOptionId, JSON.stringify(folded), nodeId);
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

  function latestDraftRowsByNode(sessionId: string) {
    const drafts = db
      .prepare("SELECT * FROM draft_versions WHERE session_id = ? ORDER BY round_index DESC, created_at DESC, rowid DESC")
      .all(sessionId) as DraftVersionRow[];
    const latestDraftByNode = new Map<string, DraftVersionRow>();
    for (const draft of drafts) {
      if (!latestDraftByNode.has(draft.node_id)) {
        latestDraftByNode.set(draft.node_id, draft);
      }
    }
    return latestDraftByNode;
  }

  function getSessionState(userId: string, sessionId: string): SessionState | null {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as
      | SessionRow
      | undefined;
    if (!session) return null;

    const root = db.prepare("SELECT * FROM root_memory WHERE id = ? AND user_id = ?").get(session.root_memory_id, userId) as
      | RootMemoryRow
      | undefined;
    if (!root) return null;

    const nodes = (db.prepare("SELECT * FROM tree_nodes WHERE session_id = ?").all(sessionId) as TreeNodeRow[])
      .map(toNode)
      .sort((a, b) => a.roundIndex - b.roundIndex);
    const drafts = db
      .prepare("SELECT * FROM draft_versions WHERE session_id = ? ORDER BY round_index DESC, created_at DESC, rowid DESC")
      .all(sessionId) as DraftVersionRow[];
    const latestDraftByNode = new Map<string, DraftVersionRow>();
    for (const draft of drafts) {
      if (!latestDraftByNode.has(draft.node_id)) {
        latestDraftByNode.set(draft.node_id, draft);
      }
    }
    const currentNode = session.current_node_id ? nodes.find((node) => node.id === session.current_node_id) ?? null : null;
    const currentDraft = latestDraftForNode(latestDraftByNode, currentNode?.id ?? null);
    const historyRows = db.prepare("SELECT * FROM branch_history WHERE session_id = ?").all(sessionId) as BranchHistoryRow[];
    const selectedPath = activePathFor(nodes, currentNode);
    const enabledSkills = enabledSkillsForSession(sessionId, userId);

    return SessionStateSchema.parse({
      rootMemory: toRootMemory(root),
      session: {
        id: session.id,
        title: session.title,
        status: SessionStatusSchema.parse(session.status === "finished" ? "active" : session.status),
        currentNodeId: session.current_node_id,
        createdAt: session.created_at,
        updatedAt: session.updated_at
      },
      currentNode,
      currentDraft,
      nodeDrafts: [...latestDraftByNode.values()].map((row) => ({ nodeId: row.node_id, draft: toDraft(row) })),
      selectedPath,
      treeNodes: nodes,
      enabledSkillIds: enabledSkills.map((skill) => skill.id),
      enabledSkills,
      foldedBranches: historyRows.map((row) => ({
        id: row.id,
        nodeId: row.node_id,
        option: BranchOptionSchema.parse(parseJson(row.option_json)),
        createdAt: row.created_at
      })),
      publishPackage: null
    });
  }

  function getLatestSessionState(userId: string): SessionState | null {
    const row = db
      .prepare("SELECT id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1")
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
    updateSkill,
    defaultEnabledSkillIds,
    resolveSkillsByIds,
    replaceSessionEnabledSkills,
    createSessionDraft,
    createDraftChild,
    activateHistoricalBranch,
    createHistoricalDraftChild,
    createEditedDraftChild,
    updateCurrentNodeDraftAndOptions,
    updateNodeDraft,
    updateNodeOptions,
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

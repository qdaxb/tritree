import { nanoid } from "nanoid";
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
import {
  defaultSkillInstallRoot,
  discoverInstalledSkills,
  stripSkillRuntimeMetadata,
  type InstalledSkillImport
} from "@/lib/skills/skill-installer";
import { appendSessionToolMemory } from "@/lib/tool-memory";
import { createDatabase, defaultDbPath } from "./client";

type RootMemoryRow = {
  id: string;
  preferences_json: string;
  summary: string;
  learned_summary: string;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  id: string;
  root_memory_id: string;
  title: string;
  status: string;
  current_node_id: string | null;
  tool_memory: string;
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
    prompt: stripSkillRuntimeMetadata(row.prompt),
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

function nextSessionToolMemory(session: Pick<SessionRow, "tool_memory">, memoryObservation: string) {
  return appendSessionToolMemory(session.tool_memory ?? "", memoryObservation);
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

export function createTreeableRepository(
  dbPath = defaultDbPath(),
  {
    skillInstallRoot = defaultSkillInstallRoot()
  }: {
    skillInstallRoot?: string;
  } = {}
) {
  const db = createDatabase(dbPath);
  cleanupStoredSkillRuntimePrompts();
  ensureSystemSkills();
  ensureDefaultCreationRequestOptions();

  function cleanupStoredSkillRuntimePrompts() {
    const timestamp = now();
    const rows = db.prepare("SELECT id, prompt FROM skills").all() as Array<Pick<SkillRow, "id" | "prompt">>;
    for (const row of rows) {
      const normalizedPrompt = stripSkillRuntimeMetadata(row.prompt);
      if (normalizedPrompt === row.prompt) continue;
      db.prepare("UPDATE skills SET prompt = ?, updated_at = ? WHERE id = ?").run(normalizedPrompt, timestamp, row.id);
    }
  }

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

  function listCreationRequestOptions({ includeArchived = false }: { includeArchived?: boolean } = {}) {
    const rows = db
      .prepare(
        includeArchived
          ? "SELECT * FROM creation_request_options ORDER BY sort_order, created_at, rowid"
          : "SELECT * FROM creation_request_options WHERE is_archived = 0 ORDER BY sort_order, created_at, rowid"
      )
      .all() as CreationRequestOptionRow[];
    return rows.map(toCreationRequestOption);
  }

  function nextCreationRequestOptionSortOrder() {
    const row = db.prepare("SELECT MAX(sort_order) AS max_sort_order FROM creation_request_options").get() as
      | { max_sort_order: number | null }
      | undefined;
    return typeof row?.max_sort_order === "number" ? row.max_sort_order + 1 : 0;
  }

  function createCreationRequestOption(input: CreationRequestOptionUpsert) {
    const parsed = CreationRequestOptionUpsertSchema.parse(input);
    const id = nanoid();
    const timestamp = now();
    const sortOrder = parsed.sortOrder ?? nextCreationRequestOptionSortOrder();

    db.prepare(
      `
        INSERT INTO creation_request_options (id, label, sort_order, is_archived, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)
      `
    ).run(id, parsed.label, sortOrder, timestamp, timestamp);

    return toCreationRequestOption(db.prepare("SELECT * FROM creation_request_options WHERE id = ?").get(id) as CreationRequestOptionRow);
  }

  function updateCreationRequestOption(optionId: string, input: Partial<CreationRequestOptionUpsert>) {
    const existing = db.prepare("SELECT * FROM creation_request_options WHERE id = ?").get(optionId) as
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
        WHERE id = ?
      `
    ).run(parsed.label, parsed.sortOrder ?? existing.sort_order, timestamp, optionId);

    return toCreationRequestOption(
      db.prepare("SELECT * FROM creation_request_options WHERE id = ?").get(optionId) as CreationRequestOptionRow
    );
  }

  function deleteCreationRequestOption(optionId: string) {
    const existing = db.prepare("SELECT * FROM creation_request_options WHERE id = ?").get(optionId) as
      | CreationRequestOptionRow
      | undefined;
    if (!existing) throw new Error("Creation request option was not found.");

    db.prepare(
      `
        UPDATE creation_request_options
        SET is_archived = 1, updated_at = ?
        WHERE id = ?
      `
    ).run(now(), optionId);
  }

  function reorderCreationRequestOptions(orderedIds: string[]) {
    const ids = Array.from(new Set(orderedIds));
    const existingIds = new Set(listCreationRequestOptions().map((option) => option.id));
    const timestamp = now();
    const orderedKnownIds = ids.filter((id) => existingIds.has(id));
    const remainingIds = listCreationRequestOptions()
      .map((option) => option.id)
      .filter((id) => !orderedKnownIds.includes(id));

    [...orderedKnownIds, ...remainingIds].forEach((id, index) => {
      db.prepare(
        `
          UPDATE creation_request_options
          SET sort_order = ?, updated_at = ?
          WHERE id = ?
        `
      ).run(index, timestamp, id);
    });

    return listCreationRequestOptions();
  }

  function resetCreationRequestOptions() {
    const timestamp = now();

    return withTransaction(db, () => {
      db.prepare("UPDATE creation_request_options SET is_archived = 1, updated_at = ?").run(timestamp);

      DEFAULT_CREATION_REQUEST_OPTIONS.forEach((option, index) => {
        const existing = db.prepare("SELECT id FROM creation_request_options WHERE id = ?").get(option.id);
        if (existing) {
          db.prepare(
            `
              UPDATE creation_request_options
              SET label = ?, sort_order = ?, is_archived = 0, updated_at = ?
              WHERE id = ?
            `
          ).run(option.label, index, timestamp, option.id);
          return;
        }

        db.prepare(
          `
            INSERT INTO creation_request_options (id, label, sort_order, is_archived, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?)
          `
        ).run(option.id, option.label, index, timestamp, timestamp);
      });

      return listCreationRequestOptions();
    });
  }

  function listSkills({ includeArchived = false }: { includeArchived?: boolean } = {}) {
    syncInstalledSkillsFromFolder();
    const rows = db
      .prepare(
        includeArchived
          ? "SELECT * FROM skills ORDER BY is_system DESC, category, title"
          : "SELECT * FROM skills WHERE is_archived = 0 ORDER BY is_system DESC, category, title"
      )
      .all() as SkillRow[];
    return rows.map(toSkill);
  }

  function defaultEnabledSkillIds() {
    return listSkills()
      .filter((skill) => skill.isSystem && skill.defaultEnabled)
      .map((skill) => skill.id);
  }

  function resolveSkillsByIds(skillIds: string[]) {
    syncInstalledSkillsFromFolder();
    const ids = uniqueSkillIds(skillIds);
    if (ids.length === 0) return [];
    return ids
      .map((id) => db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as SkillRow | undefined)
      .filter((row): row is SkillRow => Boolean(row))
      .filter((row) => !row.is_archived)
      .map(toSkill);
  }

  function createSkill(input: SkillUpsert) {
    const parsed = SkillUpsertSchema.parse(input);
    const id = nanoid();
    const timestamp = now();
    db.prepare(
      `
        INSERT INTO skills (id, title, category, description, prompt, applies_to, is_system, default_enabled, is_archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `
    ).run(
      id,
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
    return toSkill(db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as SkillRow);
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
          SET title = ?, category = ?, description = ?, prompt = ?, applies_to = ?, default_enabled = ?, is_archived = ?, updated_at = ?
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
        input.id
      );
    } else {
      db.prepare(
        `
          INSERT INTO skills (id, title, category, description, prompt, applies_to, is_system, default_enabled, is_archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `
      ).run(
        input.id,
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

    return toSkill(db.prepare("SELECT * FROM skills WHERE id = ?").get(input.id) as SkillRow);
  }

  function updateSkill(skillId: string, input: Partial<SkillUpsert>) {
    const existing = db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId) as SkillRow | undefined;
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
      skillId
    );
    return toSkill(db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId) as SkillRow);
  }

  function saveSessionEnabledSkills(sessionId: string, skillIds: string[], timestamp: string) {
    syncInstalledSkillsFromFolder();
    db.prepare("DELETE FROM session_enabled_skills WHERE session_id = ?").run(sessionId);
    for (const skillId of uniqueSkillIds(skillIds)) {
      const exists = db.prepare("SELECT id FROM skills WHERE id = ? AND is_archived = 0").get(skillId);
      if (!exists) continue;
      db.prepare(
        `
          INSERT INTO session_enabled_skills (session_id, skill_id, created_at)
          VALUES (?, ?, ?)
        `
      ).run(sessionId, skillId, timestamp);
    }
  }

  function enabledSkillsForSession(sessionId: string) {
    const rows = db
      .prepare(
        `
          SELECT skills.*
          FROM session_enabled_skills
          JOIN skills ON skills.id = session_enabled_skills.skill_id
          WHERE session_enabled_skills.session_id = ? AND skills.is_archived = 0
          ORDER BY session_enabled_skills.created_at, session_enabled_skills.rowid
        `
      )
      .all(sessionId) as SkillRow[];
    return rows.map(toSkill);
  }

  function replaceSessionEnabledSkills(sessionId: string, skillIds: string[]) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
    if (!session) throw new Error("Session was not found.");
    const timestamp = now();
    return withTransaction(db, () => {
      saveSessionEnabledSkills(sessionId, skillIds, timestamp);
      return getSessionState(sessionId);
    });
  }

  function getRootMemory() {
    const row = db.prepare("SELECT * FROM root_memory LIMIT 1").get() as RootMemoryRow | undefined;
    return row ? toRootMemory(row) : null;
  }

  function saveRootMemory(preferences: RootPreferences) {
    const parsed = RootPreferencesSchema.parse(preferences);
    const existing = getRootMemory();
    const id = existing?.id ?? "default";
    const timestamp = now();
    const summary = summarizePreferences(parsed);

    if (existing) {
      db.prepare(
        `
          UPDATE root_memory
          SET preferences_json = ?, summary = ?, updated_at = ?
          WHERE id = ?
        `
      ).run(JSON.stringify(parsed), summary, timestamp, id);
    } else {
      db.prepare(
        `
          INSERT INTO root_memory (id, preferences_json, summary, learned_summary, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      ).run(id, JSON.stringify(parsed), summary, "", timestamp, timestamp);
    }

    return getRootMemory()!;
  }

  function createSessionDraft({
    enabledSkillIds,
    rootMemoryId,
    draft,
    roundIntent = "种子念头"
  }: {
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
      db.prepare(
        `
          INSERT INTO sessions (id, root_memory_id, title, status, current_node_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      ).run(sessionId, rootMemoryId, parsedDraft.title || "Untitled Tree", "active", nodeId, timestamp, timestamp);

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

      saveSessionEnabledSkills(sessionId, enabledSkillIds ?? defaultEnabledSkillIds(), timestamp);

      const state = getSessionState(sessionId);
      if (!state) {
        throw new Error("Failed to create session draft state.");
      }
      return state;
    });
  }

  function createDraftChild({
    customOption,
    draft,
    optionMode = "balanced",
    roundIntent,
    sessionId,
    nodeId,
    selectedOptionId
  }: {
    customOption?: BranchOption;
    draft?: Draft;
    optionMode?: OptionGenerationMode;
    roundIntent?: string;
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
  }) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
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
          WHERE id = ?
        `
      ).run(nextNodeId, parsedDraft?.title || session.title || "Untitled Tree", "active", timestamp, sessionId);

      const state = getSessionState(sessionId);
      if (!state) {
        throw new Error("Failed to create draft child state.");
      }
      return state;
    });
  }

  function createEditedDraftChild({
    sessionId,
    nodeId,
    draft,
    output
  }: {
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
      sessionId,
      nodeId: draftState.currentNode!.id,
      output
    });
  }

  function updateCurrentNodeDraftAndOptions({
    sessionId,
    nodeId,
    draft,
    output
  }: {
    sessionId: string;
    nodeId: string;
    draft: Draft;
    output: DirectorOutput;
  }) {
    requireThreeOptions(output.options);
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
    if (!session) {
      throw new Error("Session was not found.");
    }
    if (session.current_node_id !== nodeId) {
      throw new Error("Edited node is not the active node.");
    }

    return createEditedDraftChild({
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
    sessionId,
    nodeId,
    output
  }: {
    sessionId: string;
    nodeId: string;
    output: DirectorDraftOutput;
  }) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
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

      const toolMemory = nextSessionToolMemory(session, output.memoryObservation);
      db.prepare(
        `
          UPDATE sessions
          SET title = ?, status = ?, tool_memory = ?, updated_at = ?
          WHERE id = ?
        `
      ).run(parsedDraft.title || session.title || "Untitled Tree", "active", toolMemory, timestamp, sessionId);

      const state = getSessionState(sessionId);
      if (!state) {
        throw new Error("Failed to update node draft.");
      }
      return state;
    });
  }

  function updateNodeOptions({
    sessionId,
    nodeId,
    output
  }: {
    sessionId: string;
    nodeId: string;
    output: DirectorOptionsOutput;
  }) {
    requireThreeOptions(output.options);
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
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

      const toolMemory = nextSessionToolMemory(session, output.memoryObservation);
      db.prepare(
        `
          UPDATE sessions
          SET tool_memory = ?, updated_at = ?
          WHERE id = ?
        `
      ).run(toolMemory, timestamp, sessionId);

      const state = getSessionState(sessionId);
      if (!state) {
        throw new Error("Failed to update session options.");
      }
      return state;
    });
  }

  function activateHistoricalBranch({
    sessionId,
    nodeId,
    selectedOptionId
  }: {
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
  }) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
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
          WHERE id = ?
        `
      ).run(existingChild.id, draft?.title || session.title, "active", timestamp, sessionId);

      return getSessionState(sessionId);
    });
  }

  function createHistoricalDraftChild({
    customOption,
    optionMode = "balanced",
    sessionId,
    nodeId,
    selectedOptionId
  }: {
    customOption?: BranchOption;
    optionMode?: OptionGenerationMode;
    sessionId: string;
    nodeId: string;
    selectedOptionId: BranchOption["id"];
  }) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
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
          WHERE id = ?
        `
      ).run(nextNodeId, "active", timestamp, sessionId);

      const state = getSessionState(sessionId);
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

  function getSessionState(sessionId: string): SessionState | null {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
    if (!session) return null;

    const root = db.prepare("SELECT * FROM root_memory WHERE id = ?").get(session.root_memory_id) as
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
    const enabledSkills = enabledSkillsForSession(sessionId);

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
      toolMemory: session.tool_memory ?? "",
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

  function getLatestSessionState(): SessionState | null {
    const row = db
      .prepare("SELECT id FROM sessions ORDER BY updated_at DESC, created_at DESC, rowid DESC LIMIT 1")
      .get() as { id: string } | undefined;

    return row ? getSessionState(row.id) : null;
  }

  return {
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

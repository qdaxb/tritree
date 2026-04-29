# Mastra Branchable Chat Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Mastra-backed branchable chat execution foundation where the Writing Agent handles normal assistant replies and the Suggestion Agent stores three next-user-message suggestions as metadata.

**Architecture:** Introduce a general `conversation_nodes` persistence model alongside the existing draft tree, add a replay builder that reconstructs the current branch as Mastra messages, define Writing and Suggestion Mastra agents with shared context but separate instructions, and expose a new NDJSON chat stream route. Existing draft/options routes remain intact during this first vertical slice.

**Tech Stack:** Next.js 16 route handlers, TypeScript 6, Vitest, Zod 4, Mastra `@mastra/core`, Mastra MCP `@mastra/mcp`, AI SDK Anthropic provider `@ai-sdk/anthropic`, SQLite via `node:sqlite`.

---

## File Structure

- Modify `package.json` and `package-lock.json`: add Mastra and AI SDK provider dependencies.
- Modify `src/lib/domain.ts`: add conversation node, source, suggestion, and chat stream event schemas.
- Modify `src/lib/db/client.ts`: add schema version 4 and `conversation_nodes` table.
- Modify `src/lib/db/schema.ts`: mirror the new `conversation_nodes` table.
- Modify `src/lib/db/repository.ts`: add conversation node row mapping and CRUD methods.
- Modify `src/lib/db/repository.test.ts`: cover conversation persistence and branch replay storage.
- Create `src/lib/conversation/messages.ts`: build branch paths and Mastra-compatible messages.
- Create `src/lib/conversation/messages.test.ts`: test prefix replay, sibling exclusion, edits, and suggestion picks.
- Create `src/lib/ai/mastra-context.ts`: build shared context text for both agents.
- Create `src/lib/ai/mastra-context.test.ts`: cover skill, memory, and tool summary rendering.
- Create `src/lib/ai/mastra-agents.ts`: define Writing and Suggestion Mastra agents plus model configuration.
- Create `src/lib/ai/mastra-executor.ts`: stream Writing Agent output and generate structured suggestions.
- Create `src/lib/ai/mastra-executor.test.ts`: use fake agents to test streaming, suggestion generation, and failure isolation.
- Create `src/app/api/sessions/[sessionId]/messages/stream/route.ts`: append a user message, stream assistant text, save assistant node, generate suggestions metadata, and return final state.
- Create `src/app/api/sessions/[sessionId]/messages/stream/route.test.ts`: cover typed input, suggestion pick provenance, assistant failure, and suggestion failure.

---

### Task 1: Add Conversation Domain Types

**Files:**
- Modify: `src/lib/domain.ts`

- [ ] **Step 1: Write failing domain tests by extending existing domain test**

Append to `src/lib/domain.test.ts`:

```ts
import {
  ChatStreamEventSchema,
  ConversationNodeSchema,
  SuggestionOutputSchema
} from "./domain";

describe("conversation schemas", () => {
  it("accepts normal assistant nodes with suggestion metadata", () => {
    const parsed = ConversationNodeSchema.parse({
      id: "assistant-1",
      sessionId: "session-1",
      parentId: "user-1",
      role: "assistant",
      content: "今天天气不错，适合继续写下去。",
      metadata: {
        source: "ai_reply",
        suggestions: [
          { id: "a", label: "代入天气", message: "查询并代入我所在地的实际天气。" },
          { id: "b", label: "更像朋友圈", message: "把这段改得更像自然的朋友圈。" },
          { id: "c", label: "继续补写", message: "继续补写这个天气带来的心情和画面。" }
        ]
      },
      createdAt: "2026-04-29T00:00:00.000Z"
    });

    expect(parsed.metadata.suggestions?.[1].message).toBe("把这段改得更像自然的朋友圈。");
  });

  it("requires exactly three suggestions in suggestion output", () => {
    expect(() =>
      SuggestionOutputSchema.parse({
        suggestions: [{ id: "a", label: "继续", message: "继续写。" }]
      })
    ).toThrow();
  });

  it("validates chat stream events", () => {
    expect(ChatStreamEventSchema.parse({ type: "text", text: "晴朗" })).toEqual({ type: "text", text: "晴朗" });
    expect(
      ChatStreamEventSchema.parse({
        type: "suggestions",
        nodeId: "assistant-1",
        suggestions: [
          { id: "a", label: "A", message: "继续写 A。" },
          { id: "b", label: "B", message: "继续写 B。" },
          { id: "c", label: "C", message: "继续写 C。" }
        ]
      })
    ).toMatchObject({ type: "suggestions", nodeId: "assistant-1" });
  });
});
```

- [ ] **Step 2: Run domain tests to verify they fail**

Run:

```bash
npm test -- src/lib/domain.test.ts
```

Expected: FAIL because `ConversationNodeSchema`, `SuggestionOutputSchema`, and `ChatStreamEventSchema` are not exported.

- [ ] **Step 3: Implement conversation schemas**

Add to `src/lib/domain.ts` after `DirectorDraftOutputSchema`:

```ts
export const ConversationRoleSchema = z.enum(["system", "user", "assistant", "tool"]);

export const ConversationSourceSchema = z.enum([
  "system",
  "user_typed",
  "suggestion_pick",
  "custom_direction",
  "user_edit",
  "ai_reply",
  "tool_result"
]);

export const ToolCallRecordSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  arguments: z.unknown().optional()
});

export const ToolResultRecordSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  result: z.unknown().optional(),
  isError: z.boolean().optional()
});

export const SuggestedUserMoveSchema = z.object({
  id: z.enum(PRIMARY_BRANCH_OPTION_IDS),
  label: z.string().trim().min(1).max(40),
  message: z.string().trim().min(1).max(1200),
  rationale: z.string().trim().max(240).optional()
});

export const SuggestionOutputSchema = z.object({
  suggestions: z
    .array(SuggestedUserMoveSchema)
    .length(3, "Suggestion Agent must return exactly three suggestions.")
}).superRefine((output, context) => {
  if (!includesDirectorOptionIdsOnce(output.suggestions)) {
    context.addIssue({
      code: "custom",
      path: ["suggestions"],
      message: DIRECTOR_OPTION_IDS_ERROR
    });
  }
});

export const ConversationMetadataSchema = z.object({
  source: ConversationSourceSchema,
  suggestionId: z.enum(PRIMARY_BRANCH_OPTION_IDS).optional(),
  toolCalls: z.array(ToolCallRecordSchema).optional(),
  toolResults: z.array(ToolResultRecordSchema).optional(),
  skillsUsed: z.array(z.string().min(1)).optional(),
  suggestions: z.array(SuggestedUserMoveSchema).optional(),
  targetNodeId: z.string().min(1).optional()
});

export const ConversationNodeSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  role: ConversationRoleSchema,
  content: z.string(),
  metadata: ConversationMetadataSchema,
  createdAt: z.string()
});
```

Add `ChatStreamEventSchema` after `SessionStateSchema`, because it references `SessionStateSchema`:

```ts
export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("assistant"), node: ConversationNodeSchema }),
  z.object({
    type: z.literal("suggestions"),
    nodeId: z.string().min(1),
    suggestions: z.array(SuggestedUserMoveSchema).length(3)
  }),
  z.object({ type: z.literal("done"), state: SessionStateSchema, assistantNodeId: z.string().min(1) }),
  z.object({ type: z.literal("error"), error: z.string() })
]);
```

Add exported types after the existing type exports:

```ts
export type ConversationRole = z.infer<typeof ConversationRoleSchema>;
export type ConversationSource = z.infer<typeof ConversationSourceSchema>;
export type SuggestedUserMove = z.infer<typeof SuggestedUserMoveSchema>;
export type SuggestionOutput = z.infer<typeof SuggestionOutputSchema>;
export type ConversationNode = z.infer<typeof ConversationNodeSchema>;
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;
export type ToolResultRecord = z.infer<typeof ToolResultRecordSchema>;
```

- [ ] **Step 4: Run domain tests to verify they pass**

Run:

```bash
npm test -- src/lib/domain.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain.ts src/lib/domain.test.ts
git commit -m "feat: add conversation domain schemas"
```

---

### Task 2: Persist Branchable Conversation Nodes

**Files:**
- Modify: `src/lib/db/client.ts`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/db/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Append to `src/lib/db/repository.test.ts`:

```ts
describe("conversation nodes", () => {
  it("creates conversation roots and children with suggestion metadata", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      seed: "写一段天气文字",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });
    const state = repo.createSessionDraft({
      rootMemoryId: root.id,
      draft: { title: "天气", body: "今天天气不错", hashtags: [], imagePrompt: "" }
    });

    const userNode = repo.createConversationNode({
      sessionId: state.session.id,
      parentId: null,
      role: "user",
      content: "今天天气不错",
      metadata: { source: "user_typed" }
    });
    const assistantNode = repo.createConversationNode({
      sessionId: state.session.id,
      parentId: userNode.id,
      role: "assistant",
      content: "今天天气不错，晴朗的天空让人想多走一段路。",
      metadata: {
        source: "ai_reply",
        suggestions: [
          { id: "a", label: "代入天气", message: "查询并代入实际天气。" },
          { id: "b", label: "换语气", message: "改得更像朋友圈。" },
          { id: "c", label: "继续写", message: "继续补写心情。" }
        ]
      }
    });

    expect(repo.listConversationNodes(state.session.id).map((node) => node.id)).toEqual([userNode.id, assistantNode.id]);
    expect(repo.getConversationPath(state.session.id, assistantNode.id).map((node) => node.content)).toEqual([
      "今天天气不错",
      "今天天气不错，晴朗的天空让人想多走一段路。"
    ]);
    expect(repo.getSessionState(state.session.id)?.session.currentNodeId).toBe(state.session.currentNodeId);
  });

  it("replays only the selected conversation branch", () => {
    const repo = createTreeableRepository(testDbPath());
    const root = repo.saveRootMemory({
      seed: "写一段天气文字",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    });
    const state = repo.createSessionDraft({
      rootMemoryId: root.id,
      draft: { title: "天气", body: "今天天气不错", hashtags: [], imagePrompt: "" }
    });

    const user = repo.createConversationNode({
      sessionId: state.session.id,
      parentId: null,
      role: "user",
      content: "今天天气不错",
      metadata: { source: "user_typed" }
    });
    const assistant = repo.createConversationNode({
      sessionId: state.session.id,
      parentId: user.id,
      role: "assistant",
      content: "晴朗的天空让人想散步。",
      metadata: { source: "ai_reply" }
    });
    const branchA = repo.createConversationNode({
      sessionId: state.session.id,
      parentId: assistant.id,
      role: "user",
      content: "代入实际天气",
      metadata: { source: "suggestion_pick", suggestionId: "a" }
    });
    repo.createConversationNode({
      sessionId: state.session.id,
      parentId: assistant.id,
      role: "user",
      content: "改成朋友圈",
      metadata: { source: "suggestion_pick", suggestionId: "b" }
    });

    expect(repo.getConversationPath(state.session.id, branchA.id).map((node) => node.content)).toEqual([
      "今天天气不错",
      "晴朗的天空让人想散步。",
      "代入实际天气"
    ]);
  });
});
```

- [ ] **Step 2: Run repository tests to verify they fail**

Run:

```bash
npm test -- src/lib/db/repository.test.ts
```

Expected: FAIL because the repository has no conversation node methods and the database has no `conversation_nodes` table.

- [ ] **Step 3: Add the database table**

In `src/lib/db/client.ts`, change:

```ts
const CURRENT_SCHEMA_VERSION = 3;
```

to:

```ts
const CURRENT_SCHEMA_VERSION = 4;
```

Add `"conversation_nodes"` to `TREEABLE_TABLES` before `"publish_packages"`:

```ts
const TREEABLE_TABLES = [
  "conversation_nodes",
  "publish_packages",
  "branch_history",
  "draft_versions",
  "tree_nodes",
  "session_enabled_skills",
  "sessions",
  "skills",
  "root_memory"
];
```

Add this table DDL after `session_enabled_skills`:

```sql
    CREATE TABLE IF NOT EXISTS conversation_nodes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      parent_id TEXT REFERENCES conversation_nodes(id),
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
```

- [ ] **Step 4: Mirror the Drizzle schema**

In `src/lib/db/schema.ts`, add after `sessionEnabledSkills`:

```ts
export const conversationNodes = sqliteTable(
  "conversation_nodes",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    parentId: text("parent_id").references((): AnySQLiteColumn => conversationNodes.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    metadataJson: text("metadata_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => [check("conversation_nodes_role_check", sql`${table.role} IN ('system', 'user', 'assistant', 'tool')`)]
);
```

- [ ] **Step 5: Implement repository methods**

In `src/lib/db/repository.ts`, update imports from `@/lib/domain`:

```ts
  ConversationMetadataSchema,
  ConversationNodeSchema,
  type ConversationMetadata,
  type ConversationNode,
  type ConversationRole,
```

Add a row type after `SkillRow`:

```ts
type ConversationNodeRow = {
  id: string;
  session_id: string;
  parent_id: string | null;
  role: string;
  content: string;
  metadata_json: string;
  created_at: string;
};
```

Add a mapper after `toSkill`:

```ts
function toConversationNode(row: ConversationNodeRow): ConversationNode {
  return ConversationNodeSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    parentId: row.parent_id,
    role: row.role,
    content: row.content,
    metadata: ConversationMetadataSchema.parse(parseJson(row.metadata_json)),
    createdAt: row.created_at
  });
}
```

Add methods before `getSessionState`:

```ts
  function createConversationNode({
    sessionId,
    parentId,
    role,
    content,
    metadata
  }: {
    sessionId: string;
    parentId: string | null;
    role: ConversationRole;
    content: string;
    metadata: ConversationMetadata;
  }) {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
    if (!session) throw new Error("Session was not found.");

    if (parentId) {
      const parent = db
        .prepare("SELECT id FROM conversation_nodes WHERE id = ? AND session_id = ?")
        .get(parentId, sessionId);
      if (!parent) throw new Error("Parent conversation node was not found.");
    }

    const id = nanoid();
    const timestamp = now();
    const parsedMetadata = ConversationMetadataSchema.parse(metadata);
    db.prepare(
      `
        INSERT INTO conversation_nodes (id, session_id, parent_id, role, content, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(id, sessionId, parentId, role, content, JSON.stringify(parsedMetadata), timestamp);

    return toConversationNode(db.prepare("SELECT * FROM conversation_nodes WHERE id = ?").get(id) as ConversationNodeRow);
  }

  function updateConversationNodeMetadata({
    sessionId,
    nodeId,
    metadata
  }: {
    sessionId: string;
    nodeId: string;
    metadata: ConversationMetadata;
  }) {
    const parsedMetadata = ConversationMetadataSchema.parse(metadata);
    const result = db
      .prepare("UPDATE conversation_nodes SET metadata_json = ? WHERE id = ? AND session_id = ?")
      .run(JSON.stringify(parsedMetadata), nodeId, sessionId);
    if (result.changes === 0) throw new Error("Conversation node was not found.");
    return toConversationNode(db.prepare("SELECT * FROM conversation_nodes WHERE id = ?").get(nodeId) as ConversationNodeRow);
  }

  function listConversationNodes(sessionId: string) {
    const rows = db
      .prepare("SELECT * FROM conversation_nodes WHERE session_id = ? ORDER BY created_at, rowid")
      .all(sessionId) as ConversationNodeRow[];
    return rows.map(toConversationNode);
  }

  function getConversationPath(sessionId: string, nodeId: string) {
    const nodes = listConversationNodes(sessionId);
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const path: ConversationNode[] = [];
    const visited = new Set<string>();
    let cursor = nodesById.get(nodeId);

    while (cursor && !visited.has(cursor.id)) {
      path.unshift(cursor);
      visited.add(cursor.id);
      cursor = cursor.parentId ? nodesById.get(cursor.parentId) : undefined;
    }

    if (path.length === 0 || path.at(-1)?.id !== nodeId) {
      throw new Error("Conversation node was not found.");
    }

    return path;
  }
```

Add the methods to the returned object:

```ts
    createConversationNode,
    updateConversationNodeMetadata,
    listConversationNodes,
    getConversationPath,
```

- [ ] **Step 6: Run repository tests to verify they pass**

Run:

```bash
npm test -- src/lib/db/repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/client.ts src/lib/db/schema.ts src/lib/db/repository.ts src/lib/db/repository.test.ts
git commit -m "feat: persist branchable conversation nodes"
```

---

### Task 3: Build Replay Messages And Shared Agent Context

**Files:**
- Create: `src/lib/conversation/messages.ts`
- Create: `src/lib/conversation/messages.test.ts`
- Create: `src/lib/ai/mastra-context.ts`
- Create: `src/lib/ai/mastra-context.test.ts`

- [ ] **Step 1: Write failing replay tests**

Create `src/lib/conversation/messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ConversationNode } from "@/lib/domain";
import { buildMastraMessagesFromPath, latestConversationNodeId } from "./messages";

const nodes: ConversationNode[] = [
  {
    id: "user-1",
    sessionId: "session-1",
    parentId: null,
    role: "user",
    content: "今天天气不错",
    metadata: { source: "user_typed" },
    createdAt: "2026-04-29T00:00:00.000Z"
  },
  {
    id: "assistant-1",
    sessionId: "session-1",
    parentId: "user-1",
    role: "assistant",
    content: "晴朗的天空让人想多走一段路。",
    metadata: {
      source: "ai_reply",
      suggestions: [
        { id: "a", label: "代入天气", message: "查询并代入实际天气。" },
        { id: "b", label: "换语气", message: "改成朋友圈。" },
        { id: "c", label: "继续写", message: "继续补写。" }
      ]
    },
    createdAt: "2026-04-29T00:00:01.000Z"
  },
  {
    id: "user-2",
    sessionId: "session-1",
    parentId: "assistant-1",
    role: "user",
    content: "查询并代入实际天气。",
    metadata: { source: "suggestion_pick", suggestionId: "a" },
    createdAt: "2026-04-29T00:00:02.000Z"
  }
];

describe("buildMastraMessagesFromPath", () => {
  it("replays content without suggestion metadata", () => {
    expect(buildMastraMessagesFromPath(nodes)).toEqual([
      { role: "user", content: "今天天气不错" },
      { role: "assistant", content: "晴朗的天空让人想多走一段路。" },
      { role: "user", content: "查询并代入实际天气。" }
    ]);
  });

  it("renders user edits as authoritative user messages", () => {
    expect(
      buildMastraMessagesFromPath([
        {
          id: "edit-1",
          sessionId: "session-1",
          parentId: "assistant-1",
          role: "user",
          content: "我把上一版改成以下版本，请以后面的内容为准继续：\n\n---\n新文本\n---",
          metadata: { source: "user_edit", targetNodeId: "assistant-1" },
          createdAt: "2026-04-29T00:00:03.000Z"
        }
      ])
    ).toEqual([
      {
        role: "user",
        content: "我把上一版改成以下版本，请以后面的内容为准继续：\n\n---\n新文本\n---"
      }
    ]);
  });
});

describe("latestConversationNodeId", () => {
  it("returns the newest node id in creation order", () => {
    expect(latestConversationNodeId(nodes)).toBe("user-2");
  });
});
```

- [ ] **Step 2: Write failing context tests**

Create `src/lib/ai/mastra-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSharedAgentContext, buildSuggestionInstructions, buildWritingInstructions } from "./mastra-context";

const input = {
  rootSummary: "Seed：写一段天气文字",
  learnedSummary: "用户喜欢具体、自然的表达。",
  longTermMemory: "用户常写朋友圈短文。",
  enabledSkills: [
    {
      id: "style-friend",
      title: "朋友圈语气",
      category: "风格",
      description: "更像自然分享。",
      prompt: "使用自然、轻松、不过度修饰的朋友圈语气。",
      isSystem: false,
      defaultEnabled: false,
      isArchived: false,
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z"
    }
  ],
  availableSkillSummaries: ["小红书标题：生成适合小红书的标题。"],
  toolSummaries: ["get_weather：查询指定地点天气。"]
};

describe("buildSharedAgentContext", () => {
  it("renders memory, skills, inactive skill summaries, and tool summaries", () => {
    const context = buildSharedAgentContext(input);

    expect(context).toContain("Seed：写一段天气文字");
    expect(context).toContain("用户喜欢具体、自然的表达。");
    expect(context).toContain("用户常写朋友圈短文。");
    expect(context).toContain("技能 1：朋友圈语气");
    expect(context).toContain("使用自然、轻松、不过度修饰的朋友圈语气。");
    expect(context).toContain("小红书标题：生成适合小红书的标题。");
    expect(context).toContain("get_weather：查询指定地点天气。");
  });
});

describe("agent instructions", () => {
  it("keeps writing and suggestion duties separate", () => {
    expect(buildWritingInstructions(input)).toContain("响应用户本轮真实请求");
    expect(buildWritingInstructions(input)).not.toContain("只输出三个候选用户输入");
    expect(buildSuggestionInstructions(input)).toContain("只输出三个候选用户输入");
    expect(buildSuggestionInstructions(input)).toContain("不要生成正文");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/lib/conversation/messages.test.ts src/lib/ai/mastra-context.test.ts
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 4: Implement replay builder**

Create `src/lib/conversation/messages.ts`:

```ts
import type { ConversationNode } from "@/lib/domain";

export type MastraConversationMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export function buildMastraMessagesFromPath(path: ConversationNode[]): MastraConversationMessage[] {
  return path.map((node) => ({
    role: node.role,
    content: node.content
  }));
}

export function latestConversationNodeId(nodes: ConversationNode[]) {
  return nodes.at(-1)?.id ?? null;
}
```

- [ ] **Step 5: Implement shared context builder**

Create `src/lib/ai/mastra-context.ts`:

```ts
import type { Skill } from "@/lib/domain";

export type SharedAgentContextInput = {
  rootSummary: string;
  learnedSummary: string;
  longTermMemory?: string;
  enabledSkills: Skill[];
  availableSkillSummaries?: string[];
  toolSummaries?: string[];
};

export function buildSharedAgentContext(input: SharedAgentContextInput) {
  return [
    "# Tritree Context",
    "Tritree 是一个写作助手。主流程是普通多轮写作对话，三选一只是候选用户输入。",
    "",
    "## Root Memory",
    input.rootSummary || "暂无 root memory。",
    "",
    "## Learned Memory",
    input.learnedSummary || "暂无已学习偏好。",
    "",
    "## Long-Term Memory",
    input.longTermMemory?.trim() || "暂无可用长期记忆。",
    "",
    "## Enabled Skills",
    formatEnabledSkills(input.enabledSkills),
    "",
    "## Available Skill Summaries",
    input.availableSkillSummaries?.length ? input.availableSkillSummaries.join("\n") : "暂无额外可用技能摘要。",
    "",
    "## Available Tool And MCP Capabilities",
    input.toolSummaries?.length ? input.toolSummaries.join("\n") : "暂无工具能力摘要。"
  ].join("\n");
}

export function buildWritingInstructions(input: SharedAgentContextInput) {
  return [
    buildSharedAgentContext(input),
    "",
    "# Writing Agent Instructions",
    "响应用户本轮真实请求。",
    "可以续写、改写、润色、解释、总结或组织内容。",
    "用户编辑过的内容是权威版本，除非用户要求改变，否则优先保留。",
    "按需要使用已启用技能、长期记忆和可用工具。",
    "不要生成三选一菜单；三选一由 Suggestion Agent 单独生成。"
  ].join("\n");
}

export function buildSuggestionInstructions(input: SharedAgentContextInput) {
  return [
    buildSharedAgentContext(input),
    "",
    "# Suggestion Agent Instructions",
    "只输出三个候选用户输入。",
    "候选内容必须是用户下一轮可以直接发送的话。",
    "不要生成正文，不要替用户执行写作任务，不要调用有副作用的工具。",
    "可以根据 enabled skills、memory 和 tool summaries 提议用户下一步要做什么。",
    "三个候选输入要互相区分，并且都适合当前对话上下文。"
  ].join("\n");
}

function formatEnabledSkills(skills: Skill[]) {
  if (skills.length === 0) return "暂无已启用技能。";

  return skills
    .map((skill, index) =>
      [
        `技能 ${index + 1}：${skill.title}`,
        `分类：${skill.category}`,
        `说明：${skill.description}`,
        `提示词：${skill.prompt}`
      ].join("\n")
    )
    .join("\n\n");
}
```

- [ ] **Step 6: Run replay and context tests to verify they pass**

Run:

```bash
npm test -- src/lib/conversation/messages.test.ts src/lib/ai/mastra-context.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/conversation/messages.ts src/lib/conversation/messages.test.ts src/lib/ai/mastra-context.ts src/lib/ai/mastra-context.test.ts
git commit -m "feat: build branch replay agent context"
```

---

### Task 4: Add Mastra Agents And Executor Boundary

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/ai/mastra-agents.ts`
- Create: `src/lib/ai/mastra-executor.ts`
- Create: `src/lib/ai/mastra-executor.test.ts`

- [ ] **Step 1: Install Mastra dependencies**

Run:

```bash
npm install @mastra/core@^1.29.0 @mastra/mcp@^1.6.0 @ai-sdk/anthropic@^3.0.72
```

Expected: `package.json` and `package-lock.json` update.

- [ ] **Step 2: Write failing executor tests with fake agents**

Create `src/lib/ai/mastra-executor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ConversationNode, SessionState } from "@/lib/domain";
import { generateSuggestions, streamWritingReply } from "./mastra-executor";

const state = {
  rootMemory: {
    id: "root",
    preferences: {
      seed: "写一段天气文字",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    },
    summary: "Seed：写一段天气文字",
    learnedSummary: "用户喜欢自然表达。",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z"
  },
  session: {
    id: "session-1",
    title: "天气",
    status: "active",
    currentNodeId: "tree-node-1",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z"
  },
  currentNode: null,
  currentDraft: null,
  nodeDrafts: [],
  selectedPath: [],
  treeNodes: [],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
} satisfies SessionState;

const path = [
  {
    id: "user-1",
    sessionId: "session-1",
    parentId: null,
    role: "user",
    content: "今天天气不错",
    metadata: { source: "user_typed" },
    createdAt: "2026-04-29T00:00:00.000Z"
  }
] satisfies ConversationNode[];

describe("streamWritingReply", () => {
  it("streams text from the injected writing agent", async () => {
    const fakeAgent = {
      stream: vi.fn(async () => ({
        textStream: async function* () {
          yield "晴朗";
          yield "的天空";
        }
      }))
    };
    const chunks: string[] = [];

    const text = await streamWritingReply({
      state,
      path,
      writingAgent: fakeAgent,
      onText: (chunk) => chunks.push(chunk)
    });

    expect(text).toBe("晴朗的天空");
    expect(chunks).toEqual(["晴朗", "的天空"]);
    expect(fakeAgent.stream).toHaveBeenCalledWith(
      expect.arrayContaining([{ role: "user", content: "今天天气不错" }]),
      expect.objectContaining({ memory: expect.objectContaining({ resource: "root", thread: "session-1" }) })
    );
  });
});

describe("generateSuggestions", () => {
  it("returns structured suggestions from the injected suggestion agent", async () => {
    const fakeAgent = {
      generate: vi.fn(async () => ({
        object: {
          suggestions: [
            { id: "a", label: "代入天气", message: "查询并代入实际天气。" },
            { id: "b", label: "换语气", message: "改成朋友圈。" },
            { id: "c", label: "继续写", message: "继续补写。" }
          ]
        }
      }))
    };

    await expect(
      generateSuggestions({
        state,
        path: [
          ...path,
          {
            id: "assistant-1",
            sessionId: "session-1",
            parentId: "user-1",
            role: "assistant",
            content: "晴朗的天空",
            metadata: { source: "ai_reply" },
            createdAt: "2026-04-29T00:00:01.000Z"
          }
        ],
        suggestionAgent: fakeAgent
      })
    ).resolves.toEqual([
      { id: "a", label: "代入天气", message: "查询并代入实际天气。" },
      { id: "b", label: "换语气", message: "改成朋友圈。" },
      { id: "c", label: "继续写", message: "继续补写。" }
    ]);
  });
});
```

- [ ] **Step 3: Run executor tests to verify they fail**

Run:

```bash
npm test -- src/lib/ai/mastra-executor.test.ts
```

Expected: FAIL because the executor module does not exist.

- [ ] **Step 4: Implement Mastra agent definitions**

Create `src/lib/ai/mastra-agents.ts`:

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { Agent } from "@mastra/core/agent";
import { getDirectorAuthToken, getDirectorBaseUrl, getDirectorModel } from "./director";
import { buildSuggestionInstructions, buildWritingInstructions, type SharedAgentContextInput } from "./mastra-context";

export function createTreeableAnthropicModel(env: Record<string, string | undefined> = process.env) {
  const apiKey = getDirectorAuthToken(env);
  if (!apiKey) {
    throw new Error("KIMI_API_KEY is not configured.");
  }

  const anthropic = createAnthropic({
    apiKey,
    baseURL: getDirectorBaseUrl(env)
  });

  return anthropic(getDirectorModel(env));
}

export function createWritingAgent(context: SharedAgentContextInput, env: Record<string, string | undefined> = process.env) {
  return new Agent({
    id: "treeable-writing-agent",
    name: "Treeable Writing Agent",
    instructions: buildWritingInstructions(context),
    model: createTreeableAnthropicModel(env)
  });
}

export function createSuggestionAgent(context: SharedAgentContextInput, env: Record<string, string | undefined> = process.env) {
  return new Agent({
    id: "treeable-suggestion-agent",
    name: "Treeable Suggestion Agent",
    instructions: buildSuggestionInstructions(context),
    model: createTreeableAnthropicModel(env)
  });
}
```

- [ ] **Step 5: Implement executor with injectable agents**

Create `src/lib/ai/mastra-executor.ts`:

```ts
import type { z } from "zod";
import { SuggestionOutputSchema, type ConversationNode, type SessionState, type SuggestedUserMove } from "@/lib/domain";
import { buildMastraMessagesFromPath, type MastraConversationMessage } from "@/lib/conversation/messages";
import { createSuggestionAgent, createWritingAgent } from "./mastra-agents";
import type { SharedAgentContextInput } from "./mastra-context";

type AgentStreamResult = {
  textStream?: AsyncIterable<string>;
  text?: Promise<string> | string;
};

type WritingAgentLike = {
  stream: (
    messages: MastraConversationMessage[],
    options: { memory: { resource: string; thread: string }; signal?: AbortSignal }
  ) => Promise<AgentStreamResult>;
};

type SuggestionAgentLike = {
  generate: (
    messages: MastraConversationMessage[],
    options: {
      memory: { resource: string; thread: string };
      structuredOutput: { schema: typeof SuggestionOutputSchema };
      signal?: AbortSignal;
    }
  ) => Promise<{ object?: z.infer<typeof SuggestionOutputSchema>; output?: z.infer<typeof SuggestionOutputSchema> }>;
};

export type AgentExecutionInput = {
  state: SessionState;
  path: ConversationNode[];
  signal?: AbortSignal;
  context?: Partial<SharedAgentContextInput>;
};

export async function streamWritingReply({
  state,
  path,
  signal,
  context,
  writingAgent,
  onText
}: AgentExecutionInput & {
  writingAgent?: WritingAgentLike;
  onText?: (chunk: string) => void;
}) {
  const agent = writingAgent ?? createWritingAgent(contextForState(state, context));
  const result = await agent.stream(buildMastraMessagesFromPath(path), {
    memory: memoryScopeForState(state),
    signal
  });

  let accumulated = "";
  if (result.textStream) {
    for await (const chunk of result.textStream) {
      accumulated += chunk;
      onText?.(chunk);
    }
    return accumulated;
  }

  const text = typeof result.text === "string" ? result.text : await result.text;
  if (text) onText?.(text);
  return text ?? "";
}

export async function generateSuggestions({
  state,
  path,
  signal,
  context,
  suggestionAgent
}: AgentExecutionInput & {
  suggestionAgent?: SuggestionAgentLike;
}): Promise<SuggestedUserMove[]> {
  const agent = suggestionAgent ?? createSuggestionAgent(contextForState(state, context));
  const result = await agent.generate(buildMastraMessagesFromPath(path), {
    memory: memoryScopeForState(state),
    structuredOutput: { schema: SuggestionOutputSchema },
    signal
  });
  const output = SuggestionOutputSchema.parse(result.object ?? result.output);
  return output.suggestions;
}

function contextForState(state: SessionState, context: Partial<SharedAgentContextInput> = {}): SharedAgentContextInput {
  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    enabledSkills: state.enabledSkills ?? [],
    ...context
  };
}

function memoryScopeForState(state: SessionState) {
  return {
    resource: state.rootMemory.id,
    thread: state.session.id
  };
}
```

- [ ] **Step 6: Run executor tests to verify they pass**

Run:

```bash
npm test -- src/lib/ai/mastra-executor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. If Mastra's concrete stream/generate types differ from the fake boundary, adjust `WritingAgentLike` and `SuggestionAgentLike` to match the installed package while preserving the tests' behavior.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/ai/mastra-agents.ts src/lib/ai/mastra-executor.ts src/lib/ai/mastra-executor.test.ts
git commit -m "feat: add mastra writing and suggestion agents"
```

---

### Task 5: Add Branchable Chat Stream API

**Files:**
- Create: `src/app/api/sessions/[sessionId]/messages/stream/route.ts`
- Create: `src/app/api/sessions/[sessionId]/messages/stream/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `src/app/api/sessions/[sessionId]/messages/stream/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());
const streamWritingReplyMock = vi.hoisted(() => vi.fn());
const generateSuggestionsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

vi.mock("@/lib/ai/mastra-executor", () => ({
  streamWritingReply: streamWritingReplyMock,
  generateSuggestions: generateSuggestionsMock
}));

const state = {
  rootMemory: {
    id: "root",
    preferences: {
      seed: "写一段天气文字",
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    },
    summary: "Seed：写一段天气文字",
    learnedSummary: "",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z"
  },
  session: {
    id: "session-1",
    title: "天气",
    status: "active",
    currentNodeId: "tree-node-1",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z"
  },
  currentNode: null,
  currentDraft: null,
  nodeDrafts: [],
  selectedPath: [],
  treeNodes: [],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
};

beforeEach(() => {
  getRepositoryMock.mockReset();
  streamWritingReplyMock.mockReset();
  generateSuggestionsMock.mockReset();
});

describe("POST /api/sessions/:sessionId/messages/stream", () => {
  it("streams assistant text, saves assistant node, and stores suggestions as metadata", async () => {
    const userNode = {
      id: "user-1",
      sessionId: "session-1",
      parentId: null,
      role: "user",
      content: "今天天气不错",
      metadata: { source: "user_typed" },
      createdAt: "2026-04-29T00:00:00.000Z"
    };
    const assistantNode = {
      id: "assistant-1",
      sessionId: "session-1",
      parentId: "user-1",
      role: "assistant",
      content: "晴朗的天空让人想多走一段路。",
      metadata: { source: "ai_reply" },
      createdAt: "2026-04-29T00:00:01.000Z"
    };
    const assistantWithSuggestions = {
      ...assistantNode,
      metadata: {
        source: "ai_reply",
        suggestions: [
          { id: "a", label: "代入天气", message: "查询并代入实际天气。" },
          { id: "b", label: "换语气", message: "改成朋友圈。" },
          { id: "c", label: "继续写", message: "继续补写。" }
        ]
      }
    };
    const repo = {
      getSessionState: vi.fn().mockReturnValue(state),
      createConversationNode: vi.fn().mockReturnValueOnce(userNode).mockReturnValueOnce(assistantNode),
      getConversationPath: vi.fn().mockReturnValueOnce([userNode]).mockReturnValueOnce([userNode, assistantNode]),
      updateConversationNodeMetadata: vi.fn().mockReturnValue(assistantWithSuggestions)
    };
    getRepositoryMock.mockReturnValue(repo);
    streamWritingReplyMock.mockImplementation(async ({ onText }) => {
      onText("晴朗");
      onText("的天空让人想多走一段路。");
      return "晴朗的天空让人想多走一段路。";
    });
    generateSuggestionsMock.mockResolvedValue(assistantWithSuggestions.metadata.suggestions);

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/messages/stream", {
        method: "POST",
        body: JSON.stringify({ content: "今天天气不错" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(text).toContain('"type":"text","text":"晴朗"');
    expect(text).toContain('"type":"assistant"');
    expect(text).toContain('"type":"suggestions"');
    expect(text).toContain('"type":"done"');
    expect(repo.createConversationNode).toHaveBeenCalledWith({
      sessionId: "session-1",
      parentId: null,
      role: "user",
      content: "今天天气不错",
      metadata: { source: "user_typed" }
    });
    expect(repo.updateConversationNodeMetadata).toHaveBeenCalledWith({
      sessionId: "session-1",
      nodeId: "assistant-1",
      metadata: assistantWithSuggestions.metadata
    });
  });

  it("saves suggestion picks as normal user messages with provenance", async () => {
    const parentNode = {
      id: "assistant-1",
      sessionId: "session-1",
      parentId: "user-1",
      role: "assistant",
      content: "晴朗的天空。",
      metadata: { source: "ai_reply" },
      createdAt: "2026-04-29T00:00:00.000Z"
    };
    const pickedNode = {
      id: "user-2",
      sessionId: "session-1",
      parentId: "assistant-1",
      role: "user",
      content: "查询并代入实际天气。",
      metadata: { source: "suggestion_pick", suggestionId: "a" },
      createdAt: "2026-04-29T00:00:01.000Z"
    };
    const assistantNode = {
      id: "assistant-2",
      sessionId: "session-1",
      parentId: "user-2",
      role: "assistant",
      content: "今天气温 24 度。",
      metadata: { source: "ai_reply" },
      createdAt: "2026-04-29T00:00:02.000Z"
    };
    const repo = {
      getSessionState: vi.fn().mockReturnValue(state),
      createConversationNode: vi.fn().mockReturnValueOnce(pickedNode).mockReturnValueOnce(assistantNode),
      getConversationPath: vi.fn().mockReturnValueOnce([parentNode, pickedNode]).mockReturnValueOnce([parentNode, pickedNode, assistantNode]),
      updateConversationNodeMetadata: vi.fn().mockReturnValue(assistantNode)
    };
    getRepositoryMock.mockReturnValue(repo);
    streamWritingReplyMock.mockResolvedValue("今天气温 24 度。");
    generateSuggestionsMock.mockRejectedValue(new Error("suggestion failed"));

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/messages/stream", {
        method: "POST",
        body: JSON.stringify({ parentId: "assistant-1", content: "查询并代入实际天气。", source: "suggestion_pick", suggestionId: "a" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(text).toContain('"type":"done"');
    expect(text).not.toContain('"type":"error"');
    expect(repo.createConversationNode).toHaveBeenCalledWith({
      sessionId: "session-1",
      parentId: "assistant-1",
      role: "user",
      content: "查询并代入实际天气。",
      metadata: { source: "suggestion_pick", suggestionId: "a" }
    });
  });
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```bash
npm test -- 'src/app/api/sessions/[sessionId]/messages/stream/route.test.ts'
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the chat stream route**

Create `src/app/api/sessions/[sessionId]/messages/stream/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateSuggestions, streamWritingReply } from "@/lib/ai/mastra-executor";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { getRepository } from "@/lib/db/repository";
import { ChatStreamEventSchema, ConversationSourceSchema } from "@/lib/domain";
import { encodeNdjson } from "@/lib/stream/ndjson";

export const runtime = "nodejs";

const MessageStreamBodySchema = z.object({
  parentId: z.string().min(1).nullable().optional(),
  content: z.string().trim().min(1).max(12000),
  source: ConversationSourceSchema.extract(["user_typed", "suggestion_pick", "custom_direction", "user_edit"]).default("user_typed"),
  suggestionId: z.enum(["a", "b", "c"]).optional(),
  targetNodeId: z.string().min(1).optional()
});

const ndjsonHeaders = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Content-Type-Options": "nosniff"
};

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  let body: z.infer<typeof MessageStreamBodySchema>;

  try {
    body = MessageStreamBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) return badRequestResponse(error);
    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = getRepository();
  const state = repository.getSessionState(sessionId);
  if (!state) {
    return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (value: unknown) => {
        controller.enqueue(encoder.encode(encodeNdjson(ChatStreamEventSchema.parse(value))));
      };

      try {
        const userNode = repository.createConversationNode({
          sessionId,
          parentId: body.parentId ?? null,
          role: "user",
          content: body.content,
          metadata: {
            source: body.source,
            ...(body.suggestionId ? { suggestionId: body.suggestionId } : {}),
            ...(body.targetNodeId ? { targetNodeId: body.targetNodeId } : {})
          }
        });
        const userPath = repository.getConversationPath(sessionId, userNode.id);
        const assistantText = await streamWritingReply({
          state,
          path: userPath,
          signal: request.signal,
          onText(text) {
            send({ type: "text", text });
          }
        });
        const assistantNode = repository.createConversationNode({
          sessionId,
          parentId: userNode.id,
          role: "assistant",
          content: assistantText,
          metadata: { source: "ai_reply" }
        });
        send({ type: "assistant", node: assistantNode });

        let finalAssistantNode = assistantNode;
        try {
          const suggestions = await generateSuggestions({
            state,
            path: repository.getConversationPath(sessionId, assistantNode.id),
            signal: request.signal
          });
          finalAssistantNode = repository.updateConversationNodeMetadata({
            sessionId,
            nodeId: assistantNode.id,
            metadata: {
              ...assistantNode.metadata,
              suggestions
            }
          });
          send({ type: "suggestions", nodeId: finalAssistantNode.id, suggestions });
        } catch (error) {
          console.error("[treeable:suggestions]", error);
        }

        const nextState = repository.getSessionState(sessionId);
        if (!nextState) throw new Error("Session disappeared before completing chat stream.");
        send({ type: "done", state: nextState, assistantNodeId: finalAssistantNode.id });
      } catch (error) {
        console.error("[treeable:messages-stream]", error);
        send({ type: "error", error: publicServerErrorMessage(error, "无法生成回复。") });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: ndjsonHeaders });
}
```

- [ ] **Step 4: Run route tests to verify they pass**

Run:

```bash
npm test -- 'src/app/api/sessions/[sessionId]/messages/stream/route.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/api/sessions/[sessionId]/messages/stream/route.ts' 'src/app/api/sessions/[sessionId]/messages/stream/route.test.ts'
git commit -m "feat: add branchable chat stream route"
```

---

### Task 6: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run targeted AI, repository, and route tests**

Run:

```bash
npm test -- src/lib/domain.test.ts src/lib/db/repository.test.ts src/lib/conversation/messages.test.ts src/lib/ai/mastra-context.test.ts src/lib/ai/mastra-executor.test.ts 'src/app/api/sessions/[sessionId]/messages/stream/route.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Review final diff**

Run:

```bash
git diff --stat HEAD
git status --short
```

Expected: only implementation files from this plan are modified, and no unrelated files are changed.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required fixes, commit them:

```bash
git add src package.json package-lock.json
git commit -m "fix: stabilize mastra chat foundation"
```

If no fixes were needed, do not create an empty commit.

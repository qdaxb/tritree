# Selected Text AI Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select body text in the visible draft or normal body editor, ask AI for a rewrite, then automatically save the replacement as a new custom-edit draft node.

**Architecture:** Add a focused AI helper for selection rewrites that returns only `{ replacementText }`, expose it through a new session route, and wire `TreeableApp` to call that route before reusing the existing custom-edit save flow. `LiveDraft` owns selection detection and the popover UI, but it does not call provider APIs directly.

**Tech Stack:** Next.js route handlers, React 19 client components, Vitest, Testing Library, Anthropic-compatible Kimi API, Zod validation.

---

## File Structure

- Create `src/lib/ai/selection-rewrite.ts`: builds the selection rewrite prompt, calls the Anthropic-compatible provider, and parses `{ replacementText }`.
- Create `src/lib/ai/selection-rewrite.test.ts`: covers prompt content, request construction, parsing, and provider error behavior.
- Create `src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.ts`: validates requests, focuses the target node, and delegates to `rewriteSelectedDraftText`.
- Create `src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.test.ts`: covers valid rewrite, unsupported fields, missing nodes, and empty instructions.
- Modify `src/components/draft/LiveDraft.tsx`: detect body selections in display and edit modes, render the AI edit popover, and submit selection metadata.
- Modify `src/components/draft/LiveDraft.test.tsx`: covers popover behavior, range capture, disabled contexts, and direct save after replacement.
- Modify `src/components/TreeableApp.tsx`: add the rewrite callback, call the new route, replace the captured range, and reuse the save flow without being blocked by the busy flag.
- Modify `src/components/TreeableApp.test.tsx`: covers rewrite route call, updated `/draft` save call, viewed node id usage, and rewrite error behavior.
- Modify `src/app/globals.css`: add styles for the selection edit popover.

---

### Task 1: AI Selection Rewrite Helper

**Files:**
- Create: `src/lib/ai/selection-rewrite.ts`
- Create: `src/lib/ai/selection-rewrite.test.ts`
- Modify: `src/lib/ai/director.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/lib/ai/selection-rewrite.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildSelectionRewritePrompt,
  buildSelectionRewriteRequest,
  parseSelectionRewriteText,
  rewriteSelectedDraftText
} from "./selection-rewrite";

const input = {
  rootSummary: "Seed：写一个产品故事",
  learnedSummary: "用户喜欢具体工作场景。",
  pathSummary: "第 1 轮：起稿；已选择：A 补真实场景",
  currentDraft: {
    title: "产品故事",
    body: "第一句。第二句要更具体。第三句。",
    hashtags: ["#产品"],
    imagePrompt: "办公室里的白板"
  },
  enabledSkills: [
    {
      id: "system-polish",
      title: "轻量润色",
      category: "表达",
      description: "保留原意，只改局部表达。",
      prompt: "优先保留用户已经写好的结构和语气。",
      isSystem: true,
      defaultEnabled: true,
      isArchived: false,
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z"
    }
  ],
  field: "body" as const,
  selectedText: "第二句要更具体。",
  instruction: "补一个真实工作细节"
};

describe("buildSelectionRewritePrompt", () => {
  it("includes draft context, selected text, instruction, path, and enabled skills", () => {
    const prompt = buildSelectionRewritePrompt(input);

    expect(prompt).toContain("Seed：写一个产品故事");
    expect(prompt).toContain("第 1 轮：起稿");
    expect(prompt).toContain("正文：第一句。第二句要更具体。第三句。");
    expect(prompt).toContain("选中的原文：\n第二句要更具体。");
    expect(prompt).toContain("修改要求：\n补一个真实工作细节");
    expect(prompt).toContain("技能 1：轻量润色");
    expect(prompt).toContain("只返回替换选区的新片段");
  });
});

describe("parseSelectionRewriteText", () => {
  it("parses replacement JSON even when wrapped in text fences", () => {
    expect(parseSelectionRewriteText('```json\n{"replacementText":"第二句加入了排期会上被追问的细节。"}\n```')).toEqual({
      replacementText: "第二句加入了排期会上被追问的细节。"
    });
  });

  it("rejects empty replacement text", () => {
    expect(() => parseSelectionRewriteText('{"replacementText":"   "}')).toThrow("AI rewrite returned empty replacement text.");
  });
});

describe("buildSelectionRewriteRequest", () => {
  it("builds an Anthropic-compatible non-streaming request", () => {
    const request = buildSelectionRewriteRequest(input, { ANTHROPIC_AUTH_TOKEN: "token", ANTHROPIC_MODEL: "model-x" });

    expect(request.url).toBe("https://api.moonshot.ai/anthropic/v1/messages");
    expect(request.headers["x-api-key"]).toBe("token");
    expect(request.body.model).toBe("model-x");
    expect(request.body.stream).toBeUndefined();
    expect(request.body.messages[0].content).toContain("补一个真实工作细节");
  });
});

describe("rewriteSelectedDraftText", () => {
  it("returns the parsed replacement from the provider response", async () => {
    const response = new Response(
      JSON.stringify({
        content: [{ type: "text", text: '{"replacementText":"第二句加入了排期会上的真实追问。"}' }]
      }),
      { status: 200 }
    );
    const fetcher = vi.fn().mockResolvedValue(response);

    await expect(
      rewriteSelectedDraftText(input, {
        env: { ANTHROPIC_AUTH_TOKEN: "token" },
        fetcher
      })
    ).resolves.toEqual({ replacementText: "第二句加入了排期会上的真实追问。" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.moonshot.ai/anthropic/v1/messages",
      expect.objectContaining({ method: "POST" })
    );
  });
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
npm test -- src/lib/ai/selection-rewrite.test.ts
```

Expected: FAIL because `src/lib/ai/selection-rewrite.ts` does not exist.

- [ ] **Step 3: Export the shared provider HTTP error helper**

Modify `src/lib/ai/director.ts` so `createDirectorStreamHttpError` can be reused by the new helper:

```ts
export async function createDirectorStreamHttpError(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) {
    return new Error(`AI Director request failed with status ${response.status}.`);
  }

  try {
    const value = JSON.parse(text) as unknown;
    if (isRecord(value)) {
      if (typeof value.error === "string") return new Error(value.error);
      if (isRecord(value.error) && typeof value.error.message === "string") return new Error(value.error.message);
    }
  } catch {
    return new Error(text);
  }

  return new Error(text);
}
```

- [ ] **Step 4: Implement the helper**

Create `src/lib/ai/selection-rewrite.ts`:

```ts
import type { Draft, Skill } from "@/lib/domain";
import { createDirectorStreamHttpError, getDirectorAuthToken, getDirectorBaseUrl, getDirectorModel } from "./director";
import { formatEnabledSkills } from "./prompts";

type SelectionRewriteFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type SelectionRewriteField = "body";

export type SelectionRewriteInput = {
  currentDraft: Draft;
  enabledSkills: Skill[];
  field: SelectionRewriteField;
  instruction: string;
  learnedSummary: string;
  pathSummary: string;
  rootSummary: string;
  selectedText: string;
};

type SelectionRewriteOptions = {
  env?: Record<string, string | undefined>;
  fetcher?: SelectionRewriteFetch;
  signal?: AbortSignal;
};

type SelectionRewriteRequest = {
  body: {
    max_tokens: number;
    messages: Array<{ content: string; role: "user" }>;
    model: string;
    stream?: boolean;
    system: string;
  };
  headers: Record<string, string>;
  url: string;
};

const SELECTION_REWRITE_SYSTEM_PROMPT = `
You rewrite only the selected passage from a Tritree draft.
Return one valid JSON object and nothing else.
All user-facing output must be Simplified Chinese unless the selected passage itself requires another language.
Do not rewrite unselected text.
Do not include explanations, Markdown, or the full draft.
`.trim();

export function buildSelectionRewritePrompt(input: SelectionRewriteInput) {
  return [
    "# 局部改写任务",
    "只返回替换选区的新片段。不要返回完整草稿，不要解释。",
    "",
    "# 创作状态",
    `创作 seed：\n${input.rootSummary}`,
    `已学习偏好：\n${input.learnedSummary || "暂无已学习偏好。"}`,
    `已选路径：\n${input.pathSummary || "暂无已选路径。"}`,
    "",
    "# 当前草稿",
    formatDraftForSelectionRewrite(input.currentDraft),
    "",
    "# 已选技能",
    formatEnabledSkills(input.enabledSkills),
    "",
    "# 选区",
    `字段：${input.field}`,
    `选中的原文：\n${input.selectedText}`,
    "",
    "# 用户修改要求",
    `修改要求：\n${input.instruction}`,
    "",
    '# 返回格式\n{"replacementText":"改写后的选区片段"}'
  ].join("\n");
}

export function buildSelectionRewriteRequest(
  input: SelectionRewriteInput,
  env: Record<string, string | undefined> = process.env
): SelectionRewriteRequest {
  const authToken = getDirectorAuthToken(env);
  if (!authToken) {
    throw new Error("KIMI_API_KEY is not configured.");
  }

  return {
    body: {
      max_tokens: 800,
      messages: [{ role: "user", content: buildSelectionRewritePrompt(input) }],
      model: getDirectorModel(env),
      system: SELECTION_REWRITE_SYSTEM_PROMPT
    },
    headers: {
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      "x-api-key": authToken
    },
    url: `${getDirectorBaseUrl(env)}/v1/messages`
  };
}

export async function rewriteSelectedDraftText(
  input: SelectionRewriteInput,
  options: SelectionRewriteOptions = {}
) {
  const request = buildSelectionRewriteRequest(input, options.env);
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: options.signal
  });

  if (!response.ok) {
    throw await createDirectorStreamHttpError(response);
  }

  const payload = (await response.json()) as unknown;
  return parseSelectionRewriteText(extractProviderText(payload));
}

export function parseSelectionRewriteText(text: string) {
  const value = parseJsonObject(text);
  if (!isRecord(value) || typeof value.replacementText !== "string") {
    throw new Error("AI rewrite returned invalid replacement text.");
  }

  const replacementText = value.replacementText.trim();
  if (!replacementText) {
    throw new Error("AI rewrite returned empty replacement text.");
  }

  return { replacementText };
}

function formatDraftForSelectionRewrite(draft: Draft) {
  return [
    `标题：${draft.title || "未命名"}`,
    `正文：${draft.body}`,
    `话题：${draft.hashtags.join("、") || "暂无"}`,
    `配图提示：${draft.imagePrompt || "暂无"}`
  ].join("\n");
}

function extractProviderText(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new Error("AI rewrite returned invalid response content.");
  }

  return value.content
    .flatMap((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : []))
    .join("");
}

function parseJsonObject(text: string) {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const jsonStart = withoutFence.indexOf("{");
  const jsonEnd = withoutFence.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error("AI rewrite returned text that is not JSON.");
  }

  return JSON.parse(withoutFence.slice(jsonStart, jsonEnd + 1)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 5: Run helper tests to verify they pass**

Run:

```bash
npm test -- src/lib/ai/selection-rewrite.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit helper**

```bash
git add src/lib/ai/director.ts src/lib/ai/selection-rewrite.ts src/lib/ai/selection-rewrite.test.ts
git commit -m "feat: add selected text rewrite helper"
```

---

### Task 2: Rewrite Selection API Route

**Files:**
- Create: `src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.ts`
- Create: `src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.test.ts`
- Modify: `src/lib/app-state.ts`

- [ ] **Step 1: Write failing route tests**

Create `src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());
const rewriteSelectedDraftTextMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

vi.mock("@/lib/ai/selection-rewrite", () => ({
  rewriteSelectedDraftText: rewriteSelectedDraftTextMock
}));

const node = {
  id: "node-1",
  sessionId: "session-1",
  parentId: null,
  parentOptionId: null,
  roundIndex: 1,
  roundIntent: "Start",
  options: [],
  selectedOptionId: null,
  foldedOptions: [],
  createdAt: "2026-04-28T00:00:00.000Z"
};

const state = {
  rootMemory: {
    id: "root",
    preferences: { seed: "写一个产品故事", domains: [], tones: [], styles: [], personas: [] },
    summary: "Seed：写一个产品故事",
    learnedSummary: "用户喜欢具体场景。",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z"
  },
  session: {
    id: "session-1",
    title: "Draft",
    status: "active",
    currentNodeId: "node-1",
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z"
  },
  currentNode: node,
  currentDraft: { title: "Draft", body: "第一句。第二句。", hashtags: ["#产品"], imagePrompt: "白板" },
  nodeDrafts: [{ nodeId: "node-1", draft: { title: "Draft", body: "第一句。第二句。", hashtags: ["#产品"], imagePrompt: "白板" } }],
  selectedPath: [node],
  treeNodes: [node],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
};

beforeEach(() => {
  getRepositoryMock.mockReset();
  rewriteSelectedDraftTextMock.mockReset();
});

describe("POST /api/sessions/:sessionId/draft/rewrite-selection", () => {
  it("rewrites selected body text with focused session context", async () => {
    getRepositoryMock.mockReturnValue({ getSessionState: vi.fn().mockReturnValue(state) });
    rewriteSelectedDraftTextMock.mockResolvedValue({ replacementText: "第二句加入一个排期会细节。" });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/rewrite-selection", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          draft: state.currentDraft,
          field: "body",
          selectedText: "第二句。",
          instruction: "补真实细节"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ replacementText: "第二句加入一个排期会细节。" });
    expect(rewriteSelectedDraftTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentDraft: state.currentDraft,
        field: "body",
        instruction: "补真实细节",
        rootSummary: "Seed：写一个产品故事",
        selectedText: "第二句。"
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("rejects unsupported fields", async () => {
    getRepositoryMock.mockReturnValue({ getSessionState: vi.fn().mockReturnValue(state) });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/rewrite-selection", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node-1",
          draft: state.currentDraft,
          field: "title",
          selectedText: "Draft",
          instruction: "改标题"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(400);
    expect(rewriteSelectedDraftTextMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing target node", async () => {
    getRepositoryMock.mockReturnValue({ getSessionState: vi.fn().mockReturnValue(state) });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/rewrite-selection", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "missing-node",
          draft: state.currentDraft,
          field: "body",
          selectedText: "第二句。",
          instruction: "补真实细节"
        })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run route tests to verify they fail**

Run:

```bash
npm test -- 'src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.test.ts'
```

Expected: FAIL because the route file does not exist.

- [ ] **Step 3: Add focused rewrite context helper**

Modify `src/lib/app-state.ts` by adding this exported function near the other summarizers:

```ts
export function summarizeSelectionRewriteForDirector(
  state: SessionState,
  draft: Draft,
  selectedText: string,
  instruction: string,
  field: "body"
) {
  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    pathSummary: formatPathForDirector(state),
    currentDraft: draft,
    enabledSkills: enabledSkillsForDirector(state),
    field,
    selectedText,
    instruction
  };
}
```

- [ ] **Step 4: Implement the route**

Create `src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { rewriteSelectedDraftText } from "@/lib/ai/selection-rewrite";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode, summarizeSelectionRewriteForDirector } from "@/lib/app-state";
import { getRepository } from "@/lib/db/repository";
import { DraftSchema } from "@/lib/domain";

export const runtime = "nodejs";

const RewriteSelectionBodySchema = z.object({
  nodeId: z.string().min(1),
  draft: DraftSchema,
  field: z.literal("body"),
  selectedText: z.string().trim().min(1).max(6000),
  instruction: z.string().trim().min(1).max(1200)
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  let body: z.infer<typeof RewriteSelectionBodySchema>;

  try {
    body = RewriteSelectionBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) {
      return badRequestResponse(error);
    }

    return NextResponse.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = getRepository();
  const state = repository.getSessionState(sessionId);
  if (!state) {
    return NextResponse.json({ error: "没有找到这次创作。" }, { status: 404 });
  }

  const focusedState = focusSessionStateForNode(state, body.nodeId);
  if (!focusedState?.currentNode) {
    return NextResponse.json({ error: "没有找到要编辑的草稿节点。" }, { status: 404 });
  }

  try {
    const output = await rewriteSelectedDraftText(
      summarizeSelectionRewriteForDirector(focusedState, body.draft, body.selectedText, body.instruction, body.field),
      { signal: request.signal }
    );
    return NextResponse.json(output);
  } catch (error) {
    console.error("[treeable:rewrite-selection]", error);
    return NextResponse.json({ error: publicServerErrorMessage(error, "无法修改选中文本。") }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run route tests to verify they pass**

Run:

```bash
npm test -- 'src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit route**

```bash
git add src/lib/app-state.ts 'src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.ts' 'src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.test.ts'
git commit -m "feat: add selected text rewrite route"
```

---

### Task 3: Treeable Rewrite Flow

**Files:**
- Modify: `src/components/TreeableApp.tsx`
- Modify: `src/components/TreeableApp.test.tsx`

- [ ] **Step 1: Write failing Treeable tests**

Modify the `LiveDraft` mock prop type in `src/components/TreeableApp.test.tsx` to include:

```ts
onRewriteSelection?: (request: {
  draft: { title?: string; body: string; hashtags?: string[]; imagePrompt?: string };
  field: "body";
  instruction: string;
  selectedText: string;
  selectionEnd: number;
  selectionStart: number;
}) => void | Promise<void>;
```

Add a mock button inside the mocked `LiveDraft` component:

```tsx
<button
  onClick={() =>
    props.onRewriteSelection?.({
      draft: {
        title: props.draft?.title ?? "Draft",
        body: "重复句。目标句。重复句。",
        hashtags: props.draft?.hashtags ?? [],
        imagePrompt: props.draft?.imagePrompt ?? ""
      },
      field: "body",
      selectedText: "目标句。",
      selectionStart: 4,
      selectionEnd: 8,
      instruction: "补一个细节"
    })
  }
  type="button"
>
  rewrite selection
</button>
```

Add this test near the existing draft save tests:

```ts
it("rewrites selected text and saves the updated draft for the viewed node", async () => {
  const draftOnlyState = {
    ...activeState,
    session: { ...activeState.session, currentNodeId: "node-2" },
    currentNode: { ...activeState.currentNode, id: "node-2", parentId: "node-1", options: [] },
    currentDraft: { title: "Edited", body: "重复句。目标句加入细节。重复句。", hashtags: ["#AI"], imagePrompt: "Tree" }
  };
  const optionsState = {
    ...draftOnlyState,
    currentNode: {
      ...draftOnlyState.currentNode,
      options: [
        { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "B", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "C", description: "C", impact: "C", kind: "finish" }
      ]
    }
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ replacementText: "目标句加入细节。" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: draftOnlyState }) })
    .mockResolvedValueOnce(optionsNdjsonResponse(optionsState));
  vi.stubGlobal("fetch", fetchMock);

  render(<TreeableApp />);

  await screen.findByTestId("live-draft");
  await userEvent.click(screen.getByRole("button", { name: "rewrite selection" }));

  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/sessions/session-1/draft/rewrite-selection",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual(
      expect.objectContaining({
        nodeId: "node-1",
        field: "body",
        selectedText: "目标句。",
        instruction: "补一个细节"
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(5, "/api/sessions/session-1/draft", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[4][1].body as string).draft.body).toBe("重复句。目标句加入细节。重复句。");
  });
});
```

- [ ] **Step 2: Run Treeable test to verify it fails**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx -t "rewrites selected text"
```

Expected: FAIL because `TreeableApp` does not pass `onRewriteSelection`.

- [ ] **Step 3: Refactor save flow and add rewrite callback**

Modify `src/components/TreeableApp.tsx` by adding these types near the other type aliases:

```ts
type DraftSelectionRewriteRequest = {
  draft: Draft;
  field: "body";
  instruction: string;
  selectedText: string;
  selectionEnd: number;
  selectionStart: number;
};
```

Extract the body of `saveDraft` into a reusable helper:

```ts
async function saveDraftForNode(draft: Draft, draftParentNodeId: string) {
  const response = await fetch(`/api/sessions/${sessionState!.session.id}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId: draftParentNodeId, draft })
  });
  const data = (await response.json()) as { state?: SessionState; error?: string };
  if (!response.ok || !data.state) throw new Error(data.error ?? "保存草稿失败。");
  const nextNodeId = data.state.currentNode?.id ?? null;
  setSessionState(data.state);
  setViewNodeId(nextNodeId);
  setCustomOption(null);
  setDraftComparison(null);
  previewDraftGeneration(data.state, nextNodeId);
  if (data.error) {
    setMessage(apiKeyMessage(data.error));
  }
  await allowDraftRender();
  await finishNodeGeneration(data.state, nextNodeId);
}
```

Then make `saveDraft` call it:

```ts
async function saveDraft(draft: Draft) {
  if (isBusy) return;
  if (!sessionState?.currentNode) return;
  const draftParentNodeId = viewNodeId ?? sessionState.currentNode.id;
  setGeneratedDiffNodeId(null);
  setIsBusy(true);
  setMessage("");
  try {
    await saveDraftForNode(draft, draftParentNodeId);
  } catch (error) {
    const text = error instanceof Error ? error.message : "保存草稿失败。";
    setMessage(apiKeyMessage(text));
  } finally {
    setGenerationStage(null);
    setStreamingDraft(null);
    setStreamingOptions(null);
    setIsBusy(false);
  }
}
```

Add the rewrite callback:

```ts
async function rewriteDraftSelection(request: DraftSelectionRewriteRequest) {
  if (isBusy) return;
  if (!sessionState?.currentNode) return;
  const draftParentNodeId = viewNodeId ?? sessionState.currentNode.id;
  setGeneratedDiffNodeId(null);
  setIsBusy(true);
  setMessage("");
  try {
    const response = await fetch(`/api/sessions/${sessionState.session.id}/draft/rewrite-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: draftParentNodeId,
        draft: request.draft,
        field: request.field,
        selectedText: request.selectedText,
        instruction: request.instruction
      })
    });
    const data = (await response.json()) as { replacementText?: string; error?: string };
    if (!response.ok || !data.replacementText) throw new Error(data.error ?? "无法修改选中文本。");
    const updatedDraft = replaceDraftSelection(request.draft, request.selectionStart, request.selectionEnd, data.replacementText);
    await saveDraftForNode(updatedDraft, draftParentNodeId);
  } catch (error) {
    const text = error instanceof Error ? error.message : "无法修改选中文本。";
    setMessage(apiKeyMessage(text));
  } finally {
    setGenerationStage(null);
    setStreamingDraft(null);
    setStreamingOptions(null);
    setIsBusy(false);
  }
}
```

Add this helper outside `TreeableApp`:

```ts
function replaceDraftSelection(draft: Draft, selectionStart: number, selectionEnd: number, replacementText: string): Draft {
  return {
    ...draft,
    body: `${draft.body.slice(0, selectionStart)}${replacementText}${draft.body.slice(selectionEnd)}`
  };
}
```

Pass the callback to `LiveDraft`:

```tsx
onRewriteSelection={rewriteDraftSelection}
```

- [ ] **Step 4: Run Treeable rewrite test to verify it passes**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx -t "rewrites selected text"
```

Expected: PASS.

- [ ] **Step 5: Commit Treeable flow**

```bash
git add src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx
git commit -m "feat: save selected text rewrites"
```

---

### Task 4: LiveDraft Selection Popover

**Files:**
- Modify: `src/components/draft/LiveDraft.tsx`
- Modify: `src/components/draft/LiveDraft.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing display-mode selection test**

Add this helper to `src/components/draft/LiveDraft.test.tsx`:

```ts
function selectTextInside(element: HTMLElement, text: string) {
  const textNode = [...element.childNodes].find((node) => node.textContent?.includes(text));
  expect(textNode).toBeDefined();
  const start = textNode!.textContent!.indexOf(text);
  const range = document.createRange();
  range.setStart(textNode!, start);
  range.setEnd(textNode!, start + text.length);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
```

Add this test:

```ts
it("opens an AI edit popover for selected body text in display mode and submits the captured range", async () => {
  const onRewriteSelection = vi.fn().mockResolvedValue(undefined);
  render(
    <LiveDraft
      draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
      isBusy={false}
      isEditable
      onRewriteSelection={onRewriteSelection}
      publishPackage={null}
    />
  );

  selectTextInside(screen.getByText("重复句。目标句。重复句。"), "目标句。");
  await userEvent.click(screen.getByText("重复句。目标句。重复句。"));
  await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "补一个细节");
  await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

  expect(onRewriteSelection).toHaveBeenCalledWith({
    draft: { title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" },
    field: "body",
    instruction: "补一个细节",
    selectedText: "目标句。",
    selectionStart: 4,
    selectionEnd: 8
  });
});
```

- [ ] **Step 2: Run display selection test to verify it fails**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "opens an AI edit popover for selected body text"
```

Expected: FAIL because no popover appears.

- [ ] **Step 3: Write failing textarea selection test**

Add this test:

```ts
it("opens an AI edit popover for selected body text in the normal editor", async () => {
  const onRewriteSelection = vi.fn().mockResolvedValue(undefined);
  render(
    <LiveDraft
      draft={{ title: "标题", body: "第一句。第二句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
      isBusy={false}
      isEditable
      onRewriteSelection={onRewriteSelection}
      onSave={vi.fn()}
      publishPackage={null}
    />
  );

  await userEvent.click(screen.getByRole("button", { name: "编辑" }));
  const bodyTextbox = screen.getByLabelText("正文") as HTMLTextAreaElement;
  bodyTextbox.setSelectionRange(4, 8);
  await userEvent.click(bodyTextbox);
  await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "更具体");
  await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

  expect(onRewriteSelection).toHaveBeenCalledWith({
    draft: { title: "标题", body: "第一句。第二句。", hashtags: ["#当前"], imagePrompt: "当前画面" },
    field: "body",
    instruction: "更具体",
    selectedText: "第二句。",
    selectionStart: 4,
    selectionEnd: 8
  });
});
```

- [ ] **Step 4: Run textarea selection test to verify it fails**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "opens an AI edit popover for selected body text in the normal editor"
```

Expected: FAIL because no popover appears.

- [ ] **Step 5: Implement selection state, handlers, and popover**

Modify the `LiveDraft` prop type:

```ts
onRewriteSelection?: (request: {
  draft: Draft;
  field: "body";
  instruction: string;
  selectedText: string;
  selectionEnd: number;
  selectionStart: number;
}) => void | Promise<void>;
```

Add local state:

```ts
const [selectionEdit, setSelectionEdit] = useState<SelectionEditState | null>(null);
const [selectionInstruction, setSelectionInstruction] = useState("");
```

Add types below the diff types:

```ts
type SelectionEditState = {
  anchor: { left: number; top: number };
  draft: Draft;
  selectedText: string;
  selectionEnd: number;
  selectionStart: number;
};
```

Add body paragraph metadata:

```ts
const bodyParagraphs = splitDraftParagraphsWithOffsets(displayContent?.body);
```

Replace paragraph rendering with:

```tsx
bodyParagraphs.map((paragraph) => (
  <p
    data-body-end={paragraph.end}
    data-body-start={paragraph.start}
    key={`${paragraph.start}-${paragraph.text}`}
    onMouseUp={captureDisplayBodySelection}
  >
    {paragraph.text}
  </p>
))
```

Add `onSelect` and `onMouseUp` to the normal body textarea:

```tsx
<textarea
  onChange={(event) => setBody(event.target.value)}
  onMouseUp={captureTextareaSelection}
  onSelect={captureTextareaSelection}
  rows={10}
  value={body}
/>
```

Add these functions inside `LiveDraft`:

```ts
function captureDisplayBodySelection(event: React.MouseEvent<HTMLElement>) {
  if (!canUseSelectionRewrite || !displayContent) return;
  const selection = window.getSelection();
  const selectedText = selection?.toString() ?? "";
  const target = event.currentTarget;
  const bodyStart = Number(target.dataset.bodyStart);
  if (!selectedText.trim() || Number.isNaN(bodyStart)) return;
  const paragraphText = target.textContent ?? "";
  const localStart = paragraphText.indexOf(selectedText);
  if (localStart < 0) return;
  openSelectionEdit({
    anchor: selectionPopoverAnchor(selection),
    draft: displayContent,
    selectedText,
    selectionStart: bodyStart + localStart,
    selectionEnd: bodyStart + localStart + selectedText.length
  });
}

function captureTextareaSelection(event: React.SyntheticEvent<HTMLTextAreaElement>) {
  if (!canUseSelectionRewrite) return;
  const target = event.currentTarget;
  if (target.selectionStart === target.selectionEnd) return;
  const selectedText = target.value.slice(target.selectionStart, target.selectionEnd);
  if (!selectedText.trim()) return;
  openSelectionEdit({
    anchor: textareaSelectionAnchor(target),
    draft: editedDraft,
    selectedText,
    selectionStart: target.selectionStart,
    selectionEnd: target.selectionEnd
  });
}

function openSelectionEdit(nextSelection: SelectionEditState) {
  setSelectionEdit(nextSelection);
  setSelectionInstruction("");
}

async function submitSelectionRewrite() {
  if (!selectionEdit || !onRewriteSelection || !selectionInstruction.trim()) return;
  await onRewriteSelection({
    draft: selectionEdit.draft,
    field: "body",
    instruction: selectionInstruction.trim(),
    selectedText: selectionEdit.selectedText,
    selectionStart: selectionEdit.selectionStart,
    selectionEnd: selectionEdit.selectionEnd
  });
  setSelectionEdit(null);
  setSelectionInstruction("");
}
```

Add derived availability:

```ts
const canUseSelectionRewrite = Boolean(content && isEditable && onRewriteSelection && !isBusy && !isComparisonMode && !isLiveDiff && !shouldShowInlineDiff);
```

Render the popover before the end of `aside`:

```tsx
{selectionEdit ? (
  <div className="draft-selection-edit" style={{ left: selectionEdit.anchor.left, top: selectionEdit.anchor.top }}>
    <p className="draft-selection-edit__preview">{previewSelectionText(selectionEdit.selectedText)}</p>
    <label>
      <span>修改要求</span>
      <textarea
        autoFocus
        onChange={(event) => setSelectionInstruction(event.target.value)}
        rows={3}
        value={selectionInstruction}
      />
    </label>
    <div className="draft-selection-edit__actions">
      <button className="secondary-button" onClick={() => setSelectionEdit(null)} type="button">
        关闭
      </button>
      <button className="start-button" disabled={!selectionInstruction.trim()} onClick={() => void submitSelectionRewrite()} type="button">
        发送修改
      </button>
    </div>
  </div>
) : null}
```

Add helpers outside `LiveDraft`:

```ts
function splitDraftParagraphsWithOffsets(body?: string) {
  const source = body ?? "";
  const matches = Array.from(source.matchAll(/[^\n]+/g));
  const paragraphs = matches
    .map((match) => {
      const rawText = match[0];
      const leadingWhitespace = rawText.match(/^\s*/)?.[0].length ?? 0;
      const text = rawText.trim();
      return {
        end: (match.index ?? 0) + leadingWhitespace + text.length,
        start: (match.index ?? 0) + leadingWhitespace,
        text
      };
    })
    .filter((paragraph) => paragraph.text.length > 0);

  return paragraphs.length ? paragraphs : [{ start: 0, end: 0, text: "第一次选择后，草稿会在这里更新。" }];
}

function selectionPopoverAnchor(selection: Selection | null) {
  const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  return {
    left: Math.max(12, rect?.left ?? 24),
    top: Math.max(12, (rect?.bottom ?? 24) + 8)
  };
}

function textareaSelectionAnchor(textarea: HTMLTextAreaElement) {
  const rect = textarea.getBoundingClientRect();
  return { left: rect.left + 12, top: rect.top + 36 };
}

function previewSelectionText(value: string) {
  const preview = value.replace(/\s+/g, " ").trim();
  return Array.from(preview).slice(0, 48).join("");
}
```

- [ ] **Step 6: Add popover CSS**

Add to `src/app/globals.css` near the draft editor styles:

```css
.draft-selection-edit {
  position: fixed;
  z-index: 30;
  width: min(320px, calc(100vw - 24px));
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18);
}

.draft-selection-edit__preview {
  margin: 0 0 10px;
  color: #334155;
  font-size: 0.86rem;
  line-height: 1.5;
}

.draft-selection-edit label {
  display: grid;
  gap: 6px;
}

.draft-selection-edit label span {
  color: #475569;
  font-size: 0.78rem;
  font-weight: 800;
}

.draft-selection-edit textarea {
  min-height: 76px;
  resize: vertical;
}

.draft-selection-edit__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
```

- [ ] **Step 7: Run LiveDraft selection tests to verify they pass**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "selected body text"
```

Expected: PASS for the two new selection tests.

- [ ] **Step 8: Commit LiveDraft popover**

```bash
git add src/components/draft/LiveDraft.tsx src/components/draft/LiveDraft.test.tsx src/app/globals.css
git commit -m "feat: add selected text edit popover"
```

---

### Task 5: Disabled Contexts And Error Coverage

**Files:**
- Modify: `src/components/draft/LiveDraft.test.tsx`
- Modify: `src/components/TreeableApp.test.tsx`
- Modify: `src/components/draft/LiveDraft.tsx`

- [ ] **Step 1: Write failing disabled-context test**

Add this test to `src/components/draft/LiveDraft.test.tsx`:

```ts
it("does not show the selected text edit popover while live diff is active", async () => {
  const onRewriteSelection = vi.fn();
  render(
    <LiveDraft
      draft={{ title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
      isBusy={false}
      isEditable
      isLiveDiff
      onRewriteSelection={onRewriteSelection}
      previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
      publishPackage={null}
    />
  );

  expect(screen.queryByRole("textbox", { name: "修改要求" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing rewrite error test**

Add this test to `src/components/TreeableApp.test.tsx`:

```ts
it("does not save a draft when selected text rewrite fails", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "无法修改选中文本。" }) });
  vi.stubGlobal("fetch", fetchMock);

  render(<TreeableApp />);

  await screen.findByTestId("live-draft");
  await userEvent.click(screen.getByRole("button", { name: "rewrite selection" }));

  expect(await screen.findByRole("status")).toHaveTextContent("无法修改选中文本。");
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
```

- [ ] **Step 3: Run focused tests to verify failures**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "does not show the selected text edit popover"
npm test -- src/components/TreeableApp.test.tsx -t "does not save a draft when selected text rewrite fails"
```

Expected: The disabled-context test should pass if Task 4 already gated the popover. The error test should pass if Task 3 throws before saving; if it fails, fix `rewriteDraftSelection` so it never calls `saveDraftForNode` after a non-OK rewrite response.

- [ ] **Step 4: Commit coverage**

```bash
git add src/components/draft/LiveDraft.tsx src/components/draft/LiveDraft.test.tsx src/components/TreeableApp.test.tsx
git commit -m "test: cover selected text rewrite edge cases"
```

---

### Task 6: Full Verification

**Files:**
- Verify all touched source and test files.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npm test -- src/lib/ai/selection-rewrite.test.ts 'src/app/api/sessions/[sessionId]/draft/rewrite-selection/route.test.ts' src/components/draft/LiveDraft.test.tsx src/components/TreeableApp.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Final commit if verification required fixes**

If verification required changes, commit them:

```bash
git add src lib docs
git commit -m "fix: stabilize selected text ai edit"
```

If verification did not require changes, do not create an empty commit.

---

## Self-Review

- Spec coverage: Tasks 1 and 2 implement model-only replacement generation; Tasks 3 and 4 implement direct replacement and custom-edit save; Task 5 covers disabled contexts and error behavior; Task 6 verifies the feature.
- Placeholder scan: The plan contains no unresolved placeholder markers or unspecified implementation steps.
- Type consistency: `field` is `"body"` throughout; selection range names are `selectionStart` and `selectionEnd`; the client callback is consistently named `onRewriteSelection`.

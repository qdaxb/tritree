# Streaming Draft Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI draft generation stream from the provider to the browser and render a live parent-to-child diff while the response is still arriving.

**Architecture:** Add provider-stream helpers in the AI layer, a new NDJSON route for draft generation, a small shared NDJSON parser for client/server tests, transient streaming draft state in `TreeableApp`, and an explicit live-diff rendering mode in `LiveDraft`. The final draft is persisted only after the accumulated provider output passes the existing strict `DirectorDraftOutputSchema` parser.

**Tech Stack:** Next.js 16 App Router route handlers, Web Streams, React 19 client state, TypeScript, Vitest, Testing Library, existing repository and domain schemas.

---

## File Structure

- Create: `src/lib/stream/ndjson.ts`
  - Encodes one JSON object per newline for server streams.
  - Parses decoded NDJSON chunks on the client without losing split lines.
- Create: `src/lib/stream/ndjson.test.ts`
  - Covers split chunks, multiple lines in one chunk, and trailing buffered data.
- Create: `src/lib/ai/director-stream.ts`
  - Builds and executes streaming draft requests.
  - Parses Anthropic-compatible SSE `content_block_delta` events.
  - Emits accumulated text callbacks and returns the final strict `DirectorDraftOutput`.
  - Extracts best-effort partial drafts from incomplete accumulated JSON.
- Create: `src/lib/ai/director-stream.test.ts`
  - Covers streaming request shape, SSE parsing, partial draft extraction, and final strict parsing.
- Modify: `src/lib/ai/director.ts`
  - Export `parseDirectorDraftText`.
  - Export `buildDirectorDraftStreamRequest`.
  - Allow `DirectorRequest.body.stream` for streaming requests.
- Create: `src/app/api/sessions/[sessionId]/draft/generate/stream/route.ts`
  - Validates the same request body as the existing draft route.
  - Streams NDJSON `draft`, `done`, and `error` events.
  - Persists by calling `repository.updateNodeDraft` after final strict parsing.
- Create: `src/app/api/sessions/[sessionId]/draft/generate/stream/route.test.ts`
  - Proves incremental events are emitted before `done`, existing drafts short-circuit, and final persistence happens once.
- Modify: `src/components/TreeableApp.tsx`
  - Reads the streaming response in `ensureNodeDraft`.
  - Stores transient streaming drafts by node id.
  - Falls back to the existing JSON route if streaming is unavailable.
- Modify: `src/components/TreeableApp.test.tsx`
  - Updates draft generation tests to expect `/draft/generate/stream`.
  - Adds a test for split NDJSON chunks and transient draft rendering.
- Modify: `src/components/draft/LiveDraft.tsx`
  - Adds `isLiveDiff` prop.
  - Automatically renders inline diff during streaming without requiring the user to click `对比`.
  - Shows a streaming cursor at the current body writing point.
  - Allows generated-diff review to be dismissed after the final draft is saved.
- Modify: `src/components/draft/LiveDraft.test.tsx`
  - Adds live-diff rendering coverage.

### Interaction Refinement Addendum

The shipped streaming path needs a follow-up adjustment to the right-panel state machine:

- `TreeableApp` should display the parent draft while the child node exists but no partial child draft has arrived yet.
- `TreeableApp` should keep the parent-to-final diff visible after the stream finishes and the final draft is persisted. This generated-diff review remains until the user dismisses it or changes context.
- `LiveDraft` should distinguish active streaming from generated-diff review. Active streaming hides editing and close controls and shows an inline cursor; generated-diff review still forces the diff view but exposes a `关闭对比` control.
- `LiveDraft` should render streaming body diff as generated prefix plus highlighted current line plus unchanged parent tail. The not-yet-generated parent body must not appear as removed text, and the highlighted current line should scroll into view as text arrives.
- The unchanged parent tail should be computed from streaming progress rather than only from the common prefix. When the new text starts differently, the old draft placeholder should shrink as partial text grows instead of remaining fully visible until completion.
- `TreeableApp` should treat stream `error` events as a failed streaming transport and try the existing JSON draft generation route. If that fallback also fails, the draftless current node should show a `重试生成` action.

---

### Task 1: Shared NDJSON Stream Utilities

**Files:**
- Create: `src/lib/stream/ndjson.ts`
- Create: `src/lib/stream/ndjson.test.ts`

- [ ] **Step 1: Write the failing NDJSON parser tests**

Add `src/lib/stream/ndjson.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createNdjsonParser, encodeNdjson } from "./ndjson";

describe("encodeNdjson", () => {
  it("serializes one JSON object per line", () => {
    expect(encodeNdjson({ type: "draft", draft: { title: "T" } })).toBe('{"type":"draft","draft":{"title":"T"}}\n');
  });
});

describe("createNdjsonParser", () => {
  it("parses complete and split lines without dropping buffered text", () => {
    const values: unknown[] = [];
    const parser = createNdjsonParser((value) => values.push(value));

    parser.push('{"type":"draft","draft":{"body":"一');
    parser.push('段"}}\n{"type":"done","state":{"session":{"id":"s1"}}}\n');
    parser.flush();

    expect(values).toEqual([
      { type: "draft", draft: { body: "一段" } },
      { type: "done", state: { session: { id: "s1" } } }
    ]);
  });

  it("throws a clear error when the final buffered line is invalid JSON", () => {
    const parser = createNdjsonParser(() => {});
    parser.push('{"type":"draft"');

    expect(() => parser.flush()).toThrow("Invalid NDJSON stream event.");
  });
});
```

- [ ] **Step 2: Run the NDJSON tests and verify they fail**

Run:

```bash
npm test -- src/lib/stream/ndjson.test.ts
```

Expected: FAIL because `src/lib/stream/ndjson.ts` does not exist.

- [ ] **Step 3: Implement the NDJSON utilities**

Create `src/lib/stream/ndjson.ts`:

```ts
export function encodeNdjson(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}

export function createNdjsonParser(onValue: (value: unknown) => void) {
  let buffer = "";

  function parseLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      onValue(JSON.parse(trimmed) as unknown);
    } catch (error) {
      throw new Error("Invalid NDJSON stream event.", { cause: error });
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        parseLine(line);
      }
    },
    flush() {
      parseLine(buffer);
      buffer = "";
    }
  };
}
```

- [ ] **Step 4: Run the NDJSON tests and verify they pass**

Run:

```bash
npm test -- src/lib/stream/ndjson.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/lib/stream/ndjson.ts src/lib/stream/ndjson.test.ts
git commit -m "feat: add ndjson stream utilities"
```

---

### Task 2: AI Streaming Helpers

**Files:**
- Modify: `src/lib/ai/director.ts`
- Create: `src/lib/ai/director-stream.ts`
- Create: `src/lib/ai/director-stream.test.ts`
- Modify: `src/lib/ai/director.test.ts`

- [ ] **Step 1: Write failing tests for streaming request shape and final parsing**

Add these imports to `src/lib/ai/director.test.ts`:

```ts
import {
  buildDirectorDraftStreamRequest,
  parseDirectorDraftText
} from "./director";
```

Add tests near the existing director request tests:

```ts
describe("buildDirectorDraftStreamRequest", () => {
  it("adds stream true to the draft-only request", () => {
    const request = buildDirectorDraftStreamRequest(
      {
        rootSummary: "Seed：写一个产品故事",
        learnedSummary: "",
        currentDraft: "标题：旧\n正文：旧正文",
        pathSummary: "",
        foldedSummary: "",
        selectedOptionLabel: "扩写",
        enabledSkills: []
      },
      {
        ANTHROPIC_AUTH_TOKEN: "kimi-token",
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ANTHROPIC_MODEL: "kimi-for-coding"
      }
    );

    expect(request.url).toBe("https://api.kimi.com/coding/v1/messages");
    expect(request.body.stream).toBe(true);
    expect(request.body.system).toContain("只生成本轮 draft");
  });
});

describe("parseDirectorDraftText", () => {
  it("parses a complete draft JSON string", () => {
    const parsed = parseDirectorDraftText(
      JSON.stringify({
        roundIntent: "扩写",
        draft: { title: "新标题", body: "新正文", hashtags: ["#AI"], imagePrompt: "新图" },
        memoryObservation: "用户偏好具体场景。",
        finishAvailable: false,
        publishPackage: null
      })
    );

    expect(parsed.draft.body).toBe("新正文");
  });
});
```

- [ ] **Step 2: Run director tests and verify they fail**

Run:

```bash
npm test -- src/lib/ai/director.test.ts
```

Expected: FAIL because `buildDirectorDraftStreamRequest` and `parseDirectorDraftText` are not exported.

- [ ] **Step 3: Modify `director.ts` for streaming draft requests**

Change the internal request type in `src/lib/ai/director.ts`:

```ts
type DirectorRequest = {
  body: {
    max_tokens: number;
    messages: DirectorMessage[];
    model: string;
    stream?: boolean;
    system: string;
  };
  headers: Record<string, string>;
  url: string;
};
```

Add:

```ts
export function parseDirectorDraftText(text: string): DirectorDraftOutput {
  return parseDirectorDraftOutput(parseJsonObject(text));
}

export function buildDirectorDraftStreamRequest(
  parts: DirectorInputParts,
  env: Record<string, string | undefined> = process.env
): DirectorRequest {
  const request = buildDirectorDraftRequest(parts, env);
  return {
    ...request,
    body: {
      ...request.body,
      stream: true
    }
  };
}
```

Update `parseDirectorDraftResponse` to use the new exported parser:

```ts
export function parseDirectorDraftResponse(response: DirectorResponseLike): DirectorDraftOutput {
  const text = response.content?.find((block) => block.type === "text" && typeof block.text === "string")?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("AI Director returned no text output.");
  }

  return parseDirectorDraftText(text);
}
```

- [ ] **Step 4: Run director tests and verify they pass**

Run:

```bash
npm test -- src/lib/ai/director.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing tests for SSE text deltas and partial draft parsing**

Create `src/lib/ai/director-stream.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  extractPartialDirectorDraft,
  parseAnthropicSseTextDeltas,
  streamDirectorDraft
} from "./director-stream";

const directorInput = {
  rootSummary: "Seed：写一个产品故事",
  learnedSummary: "",
  currentDraft: "标题：旧\n正文：旧正文",
  pathSummary: "",
  foldedSummary: "",
  selectedOptionLabel: "扩写",
  enabledSkills: []
};

describe("parseAnthropicSseTextDeltas", () => {
  it("extracts text_delta chunks and ignores non-text events", () => {
    const chunks = parseAnthropicSseTextDeltas(
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"m1"}}',
        "",
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"draft\\":"}}',
        "",
        'event: ping',
        'data: {"type":"ping"}',
        "",
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"body\\":\\"新\\"}"}}',
        ""
      ].join("\n")
    );

    expect(chunks).toEqual(['{"draft":', '{"body":"新"}']);
  });
});

describe("extractPartialDirectorDraft", () => {
  it("returns a best-effort draft from incomplete accumulated JSON", () => {
    expect(
      extractPartialDirectorDraft(
        '{"roundIntent":"扩写","draft":{"title":"新标题","body":"第一段正在生成","hashtags":["#AI"],"imagePrompt":"'
      )
    ).toEqual({
      title: "新标题",
      body: "第一段正在生成",
      hashtags: ["#AI"],
      imagePrompt: ""
    });
  });
});

describe("streamDirectorDraft", () => {
  it("calls onText with accumulated text and returns the final parsed draft", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'event: content_block_delta',
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"roundIntent\\":\\"扩写\\",\\"draft\\":{\\"title\\":\\"新标题\\",\\"body\\":\\"新正文\\",\\"hashtags\\":[\\"#AI\\"],\\"imagePrompt\\":\\"新图\\"},\\"memoryObservation\\":\\"观察\\",\\"finishAvailable\\":false,\\"publishPackage\\":null}"}}',
                "",
                'event: message_stop',
                'data: {"type":"message_stop"}',
                ""
              ].join("\n")
            )
          );
          controller.close();
        }
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
    const fetchMock = vi.fn().mockResolvedValue(response);
    const onText = vi.fn();

    const output = await streamDirectorDraft(directorInput, {
      env: { ANTHROPIC_AUTH_TOKEN: "token" },
      fetcher: fetchMock,
      onText
    });

    expect(onText).toHaveBeenCalledWith(expect.objectContaining({ accumulatedText: expect.stringContaining("新正文") }));
    expect(output.draft.body).toBe("新正文");
  });
});
```

- [ ] **Step 6: Run stream helper tests and verify they fail**

Run:

```bash
npm test -- src/lib/ai/director-stream.test.ts
```

Expected: FAIL because `src/lib/ai/director-stream.ts` does not exist.

- [ ] **Step 7: Implement the AI stream helper**

Create `src/lib/ai/director-stream.ts`:

```ts
import type { Draft, DirectorDraftOutput } from "@/lib/domain";
import { buildDirectorDraftStreamRequest, parseDirectorDraftText } from "./director";
import type { DirectorInputParts } from "./prompts";

type StreamDirectorDraftOptions = {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  onText?: (event: { delta: string; accumulatedText: string }) => void;
};

type AnthropicStreamEvent = {
  type?: string;
  delta?: {
    type?: string;
    text?: string;
  };
  error?: {
    message?: string;
  };
};

export async function streamDirectorDraft(
  parts: DirectorInputParts,
  options: StreamDirectorDraftOptions = {}
): Promise<DirectorDraftOutput> {
  const request = buildDirectorDraftStreamRequest(parts, options.env);
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `AI Director streaming request failed with status ${response.status}.`);
  }
  if (!response.body) {
    throw new Error("AI Director streaming response had no body.");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = "";
  let accumulatedText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const events = pending.split("\n\n");
    pending = events.pop() ?? "";

    for (const eventText of events) {
      for (const delta of parseAnthropicSseTextDeltas(eventText)) {
        accumulatedText += delta;
        options.onText?.({ delta, accumulatedText });
      }
    }
  }

  pending += decoder.decode();
  for (const delta of parseAnthropicSseTextDeltas(pending)) {
    accumulatedText += delta;
    options.onText?.({ delta, accumulatedText });
  }

  if (!accumulatedText.trim()) {
    throw new Error("AI Director returned no streamed text output.");
  }

  return parseDirectorDraftText(accumulatedText);
}

export function parseAnthropicSseTextDeltas(text: string) {
  const chunks: string[] = [];
  const blocks = text.split(/\n\n+/);

  for (const block of blocks) {
    const dataLines = block
      .split(/\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    if (data === "[DONE]") continue;

    let event: AnthropicStreamEvent;
    try {
      event = JSON.parse(data) as AnthropicStreamEvent;
    } catch {
      continue;
    }

    if (event.type === "error") {
      throw new Error(event.error?.message ?? "AI Director stream returned an error.");
    }
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
      chunks.push(event.delta.text);
    }
  }

  return chunks;
}

export function extractPartialDirectorDraft(text: string): Draft | null {
  const draftStart = text.indexOf('"draft"');
  if (draftStart < 0) return null;

  const title = extractJsonStringField(text, "title");
  const body = extractJsonStringField(text, "body");
  const imagePrompt = extractJsonStringField(text, "imagePrompt");
  const hashtags = extractJsonStringArrayField(text, "hashtags");

  if (!title && !body && hashtags.length === 0 && !imagePrompt) return null;

  return {
    title: title ?? "",
    body: body ?? "",
    hashtags,
    imagePrompt: imagePrompt ?? ""
  };
}

function extractJsonStringField(text: string, field: string) {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`);
  const match = pattern.exec(text);
  return match ? unescapeJsonString(match[1]) : null;
}

function extractJsonStringArrayField(text: string, field: string) {
  const pattern = new RegExp(`"${field}"\\s*:\\s*\\[([^\\]]*)\\]`);
  const match = pattern.exec(text);
  if (!match) return [];

  return Array.from(match[1].matchAll(/"((?:\\.|[^"\\])*)"/g), (item) => unescapeJsonString(item[1]));
}

function unescapeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
  }
}
```

- [ ] **Step 8: Run stream helper tests and verify they pass**

Run:

```bash
npm test -- src/lib/ai/director-stream.test.ts src/lib/ai/director.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add src/lib/ai/director.ts src/lib/ai/director.test.ts src/lib/ai/director-stream.ts src/lib/ai/director-stream.test.ts
git commit -m "feat: stream director draft output"
```

---

### Task 3: Streaming Draft Generate Route

**Files:**
- Create: `src/app/api/sessions/[sessionId]/draft/generate/stream/route.ts`
- Create: `src/app/api/sessions/[sessionId]/draft/generate/stream/route.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `src/app/api/sessions/[sessionId]/draft/generate/stream/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const streamDirectorDraftMock = vi.hoisted(() => vi.fn());
const extractPartialDirectorDraftMock = vi.hoisted(() => vi.fn());
const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/director-stream", () => ({
  streamDirectorDraft: streamDirectorDraftMock,
  extractPartialDirectorDraft: extractPartialDirectorDraftMock
}));

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

const parentNode = {
  id: "node-1",
  sessionId: "session-1",
  parentId: null,
  parentOptionId: null,
  roundIndex: 1,
  roundIntent: "Start",
  options: [{ id: "a", label: "扩写", description: "扩写", impact: "更完整", kind: "deepen" }],
  selectedOptionId: "a",
  foldedOptions: [],
  createdAt: "2026-04-27T00:00:00.000Z"
};

const childNode = {
  id: "node-2",
  sessionId: "session-1",
  parentId: "node-1",
  parentOptionId: "a",
  roundIndex: 2,
  roundIntent: "扩写",
  options: [],
  selectedOptionId: null,
  foldedOptions: [],
  createdAt: "2026-04-27T00:00:00.000Z"
};

const state = {
  rootMemory: {
    id: "root",
    preferences: {
      seed: "写一个产品故事",
      initialOptionId: null,
      initialOptionMode: null,
      domains: ["创作"],
      tones: ["平静"],
      styles: ["观点型"],
      personas: ["实践者"]
    },
    summary: "Seed：写一个产品故事",
    learnedSummary: "",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  },
  session: {
    id: "session-1",
    title: "Draft",
    status: "active",
    currentNodeId: "node-2",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z"
  },
  currentNode: childNode,
  currentDraft: null,
  nodeDrafts: [{ nodeId: "node-1", draft: { title: "旧", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" } }],
  selectedPath: [parentNode, childNode],
  treeNodes: [parentNode, childNode],
  enabledSkillIds: [],
  enabledSkills: [],
  foldedBranches: [],
  publishPackage: null
};

beforeEach(() => {
  streamDirectorDraftMock.mockReset();
  extractPartialDirectorDraftMock.mockReset();
  getRepositoryMock.mockReset();
});

describe("POST /api/sessions/:sessionId/draft/generate/stream", () => {
  it("streams partial draft events before persisting and sending done", async () => {
    const finalOutput = {
      roundIntent: "扩写",
      draft: { title: "新", body: "新正文", hashtags: ["#新"], imagePrompt: "新图" },
      memoryObservation: "观察",
      finishAvailable: false,
      publishPackage: null
    };
    const finalState = {
      ...state,
      currentDraft: finalOutput.draft,
      nodeDrafts: [...state.nodeDrafts, { nodeId: "node-2", draft: finalOutput.draft }]
    };
    const updateNodeDraft = vi.fn().mockReturnValue(finalState);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeDraft
    });
    extractPartialDirectorDraftMock.mockReturnValueOnce({ title: "新", body: "新", hashtags: [], imagePrompt: "" });
    streamDirectorDraftMock.mockImplementation(async (_parts, options) => {
      options.onText({ delta: "新", accumulatedText: '{"draft":{"title":"新","body":"新' });
      return finalOutput;
    });

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/draft/generate/stream", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    const text = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(text).toContain('"type":"draft"');
    expect(text).toContain('"type":"done"');
    expect(text.indexOf('"type":"draft"')).toBeLessThan(text.indexOf('"type":"done"'));
    expect(updateNodeDraft).toHaveBeenCalledWith({
      sessionId: "session-1",
      nodeId: "node-2",
      output: finalOutput
    });
  });
});
```

- [ ] **Step 2: Run the stream route test and verify it fails**

Run:

```bash
npm test -- 'src/app/api/sessions/[sessionId]/draft/generate/stream/route.test.ts'
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the stream route**

Create `src/app/api/sessions/[sessionId]/draft/generate/stream/route.ts` with the same validation pattern as `src/app/api/sessions/[sessionId]/draft/generate/route.ts`, plus this streaming response shape:

```ts
import { z } from "zod";
import { streamDirectorDraft, extractPartialDirectorDraft } from "@/lib/ai/director-stream";
import { badRequestResponse, isBadRequestError, publicServerErrorMessage } from "@/lib/api/errors";
import { focusSessionStateForNode, summarizeSessionForDirector } from "@/lib/app-state";
import { getRepository } from "@/lib/db/repository";
import { INITIAL_GUIDE_OPTIONS, OptionGenerationModeSchema, type BranchOption, type SessionState, type TreeNode } from "@/lib/domain";
import { encodeNdjson } from "@/lib/stream/ndjson";

export const runtime = "nodejs";

const DraftGenerateBodySchema = z.object({
  nodeId: z.string().min(1),
  note: z.string().max(1200).optional(),
  optionMode: OptionGenerationModeSchema.default("balanced")
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  let body: z.infer<typeof DraftGenerateBodySchema>;

  try {
    body = DraftGenerateBodySchema.parse(await request.json());
  } catch (error) {
    if (isBadRequestError(error)) return badRequestResponse(error);
    return Response.json({ error: "请求内容格式不正确。" }, { status: 400 });
  }

  const repository = getRepository();
  const state = repository.getSessionState(sessionId);
  const validation = validateDraftStreamTarget(state, body.nodeId);
  if ("response" in validation) return validation.response;

  const { parentState, selectedOption, targetNode } = validation;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(value: unknown) {
        controller.enqueue(encoder.encode(encodeNdjson(value)));
      }

      try {
        if (state!.nodeDrafts.some((item) => item.nodeId === body.nodeId)) {
          send({ type: "done", state });
          controller.close();
          return;
        }

        const output = await streamDirectorDraft(
          summarizeSessionForDirector(parentState, selectedOption, body.note, selectedOption.mode ?? body.optionMode),
          {
            onText({ accumulatedText }) {
              const draft = extractPartialDirectorDraft(accumulatedText);
              if (draft) send({ type: "draft", draft });
            }
          }
        );
        const nextState = repository.updateNodeDraft({ sessionId, nodeId: targetNode.id, output });
        send({ type: "done", state: nextState });
      } catch (error) {
        send({ type: "error", error: publicServerErrorMessage(error, "无法生成下一版草稿。") });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function validateDraftStreamTarget(state: SessionState | null, nodeId: string) {
  if (!state) return { response: Response.json({ error: "没有找到这次创作。" }, { status: 404 }) };
  if (state.session.status === "finished") return { response: Response.json({ error: "这次创作已经完成。" }, { status: 409 }) };

  const targetNode = findTreeNode(state, nodeId);
  if (!targetNode) return { response: Response.json({ error: "没有找到要生成草稿的节点。" }, { status: 404 }) };

  const parentState = parentStateForDraftNode(state, targetNode);
  const selectedOption = selectedOptionForDraftNode(parentState, targetNode);
  if (!parentState || !selectedOption) {
    return { response: Response.json({ error: "没有找到这个节点的进入方向。" }, { status: 400 }) };
  }

  return { parentState, selectedOption, targetNode };
}

function findTreeNode(state: SessionState, nodeId: string) {
  return state.treeNodes?.find((node) => node.id === nodeId) ?? state.selectedPath.find((node) => node.id === nodeId) ?? null;
}

function parentStateForDraftNode(state: SessionState, node: TreeNode) {
  if (node.parentId) return focusSessionStateForNode(state, node.parentId);
  return state;
}

function selectedOptionForDraftNode(state: SessionState | null, node: TreeNode): BranchOption | null {
  if (!state || !node.parentOptionId) return null;
  if (node.parentId) return state.currentNode?.options.find((option) => option.id === node.parentOptionId) ?? null;
  return INITIAL_GUIDE_OPTIONS.find((option) => option.id === node.parentOptionId) ?? null;
}
```

- [ ] **Step 4: Run the stream route test and verify it passes**

Run:

```bash
npm test -- 'src/app/api/sessions/[sessionId]/draft/generate/stream/route.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add 'src/app/api/sessions/[sessionId]/draft/generate/stream/route.ts' 'src/app/api/sessions/[sessionId]/draft/generate/stream/route.test.ts'
git commit -m "feat: add streaming draft generate route"
```

---

### Task 4: Live Diff Rendering In `LiveDraft`

**Files:**
- Modify: `src/components/draft/LiveDraft.tsx`
- Modify: `src/components/draft/LiveDraft.test.tsx`

- [ ] **Step 1: Write the failing live-diff test**

Add this test to `src/components/draft/LiveDraft.test.tsx`:

```tsx
it("automatically renders parent-to-streaming draft diff in live diff mode", () => {
  render(
    <LiveDraft
      draft={{ title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
      isBusy
      isLiveDiff
      previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
      publishPackage={null}
    />
  );

  expect(screen.getByText("AI 正在生成下一版草稿...")).toBeInTheDocument();
  expect(screen.getByText("新增句")).toHaveClass("draft-diff-token--added");
  expect(screen.getByText("旧标题")).toHaveClass("draft-diff-token--removed");
  expect(screen.queryByRole("button", { name: "对比" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run `LiveDraft` tests and verify they fail**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx
```

Expected: FAIL because `isLiveDiff` is not a supported prop and inline diff still requires explicit comparison state.

- [ ] **Step 3: Implement `isLiveDiff` in `LiveDraft`**

Update the component signature in `src/components/draft/LiveDraft.tsx`:

```tsx
export function LiveDraft({
  canCompareDrafts = false,
  comparisonDrafts = null,
  comparisonLabels = null,
  comparisonSelectionCount = 0,
  draft,
  headerActions,
  headerPanel,
  isEditable = false,
  isBusy,
  isComparisonMode = false,
  isLiveDiff = false,
  mode = "current",
  onCancelComparison,
  onSave,
  onStartComparison,
  previousDraft = null,
  publishPackage
}: {
  canCompareDrafts?: boolean;
  comparisonDrafts?: { from: Draft; to: Draft } | null;
  comparisonLabels?: { from: string; to: string } | null;
  comparisonSelectionCount?: number;
  draft: Draft | null;
  headerActions?: ReactNode;
  headerPanel?: ReactNode;
  isEditable?: boolean;
  isBusy: boolean;
  isComparisonMode?: boolean;
  isLiveDiff?: boolean;
  mode?: "current" | "history";
  onCancelComparison?: () => void;
  onSave?: (draft: Draft) => void | Promise<void>;
  onStartComparison?: () => void;
  previousDraft?: Draft | null;
  publishPackage: PublishPackage | null;
}) {
```

Change the diff and controls booleans:

```ts
const canShowParentDiff = Boolean(content && previousDraft && !publishPackage && !isEditing);
const canShowDiffControl = Boolean(
  content && !publishPackage && !isEditing && !isLiveDiff && (canCompareDrafts || canShowParentDiff || isComparisonMode)
);
const shouldShowInlineDiff = Boolean(
  draftDiff && !publishPackage && !isEditing && (isLiveDiff || comparisonDrafts || (showDiff && canShowParentDiff))
);
const canEditCurrentDraft = Boolean(content && isEditable && !publishPackage && !isComparisonMode && !isLiveDiff);
```

Leave the existing busy status text unchanged so tests keep matching the current UI copy:

```tsx
{isBusy ? <p className="updating">AI 正在生成下一版草稿...</p> : null}
```

- [ ] **Step 4: Run `LiveDraft` tests and verify they pass**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/components/draft/LiveDraft.tsx src/components/draft/LiveDraft.test.tsx
git commit -m "feat: show live draft diff"
```

---

### Task 5: Client Streaming Reader In `TreeableApp`

**Files:**
- Modify: `src/components/TreeableApp.tsx`
- Modify: `src/components/TreeableApp.test.tsx`

- [ ] **Step 1: Extend the `LiveDraft` mock prop type**

In `src/components/TreeableApp.test.tsx`, add these fields to the mocked `LiveDraft` props:

```ts
isLiveDiff?: boolean;
previousDraft?: { title?: string; body: string; hashtags?: string[]; imagePrompt?: string } | null;
```

- [ ] **Step 2: Write the failing client streaming test**

Add this helper near the test setup:

```ts
function ndjsonResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    }),
    json: async () => {
      throw new Error("stream response should not call json");
    }
  };
}
```

Add this new test after the existing "shows a selected child node before generating its draft and options" test:

```ts
it("streams a transient draft diff before applying the final generated state", async () => {
  const nodeOnlyState = {
    ...activeState,
    session: { ...activeState.session, currentNodeId: "node-2" },
    currentNode: {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      parentOptionId: "a" as const,
      roundIndex: 2,
      roundIntent: "A",
      options: []
    },
    currentDraft: null,
    selectedPath: [
      activeState.currentNode,
      { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
    ],
    treeNodes: [
      activeState.currentNode,
      { ...activeState.currentNode, id: "node-2", parentId: "node-1", parentOptionId: "a" as const, options: [] }
    ]
  };
  const finalDraft = { title: "Draft first", body: "Draft body first", hashtags: ["#draft"], imagePrompt: "draft image" };
  const draftState = {
    ...nodeOnlyState,
    currentDraft: finalDraft,
    nodeDrafts: [...activeState.nodeDrafts, { nodeId: "node-2", draft: finalDraft }]
  };
  const optionsState = {
    ...draftState,
    currentNode: {
      ...draftState.currentNode,
      options: [
        { id: "a", label: "Next A", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "Next B", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "Next C", description: "C", impact: "C", kind: "finish" }
      ]
    }
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: nodeOnlyState }) })
    .mockResolvedValueOnce(
      ndjsonResponse([
        '{"type":"draft","draft":{"title":"Draft first","body":"Draft body","hashtags":["#draft"],"imagePrompt":""}}\n',
        `${JSON.stringify({ type: "done", state: draftState })}\n`
      ])
    )
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: optionsState }) });
  vi.stubGlobal("fetch", fetchMock);

  render(<TreeableApp />);

  await userEvent.click(await screen.findByRole("button", { name: "choose displayed option" }));

  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/sessions/session-1/draft/generate/stream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ nodeId: "node-2" })
      })
    );
    expect(liveDraftMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draft: { title: "Draft first", body: "Draft body", hashtags: ["#draft"], imagePrompt: "" },
        isLiveDiff: true,
        previousDraft: activeState.nodeDrafts[0].draft
      })
    );
  });

  await vi.waitFor(() => {
    expect(liveDraftMock).toHaveBeenLastCalledWith(expect.objectContaining({ draft: optionsState.currentDraft }));
    expect(screen.getByTestId("canvas-generation-stage")).toHaveTextContent("idle");
  });
});
```

- [ ] **Step 3: Run `TreeableApp` tests and verify they fail**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected: FAIL because the client still calls `/draft/generate` and has no transient draft state.

- [ ] **Step 4: Add transient streaming draft state and route reader**

In `src/components/TreeableApp.tsx`, import:

```ts
import { createNdjsonParser } from "@/lib/stream/ndjson";
```

Add these types and state near existing generation state:

```ts
type StreamingDraftEntry = { nodeId: string; draft: Draft };
type DraftStreamEvent =
  | { type: "draft"; draft: Draft }
  | { type: "done"; state: SessionState }
  | { type: "error"; error: string }
  | { type: "text"; text: string };

const [streamingDraft, setStreamingDraft] = useState<StreamingDraftEntry | null>(null);
```

Add helpers:

```ts
function isDraftStreamEvent(value: unknown): value is DraftStreamEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as { type?: unknown };
  return event.type === "draft" || event.type === "done" || event.type === "error" || event.type === "text";
}

async function readDraftStream(response: Response, nodeId: string) {
  if (!response.body) return null;

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let doneState: SessionState | null = null;
  const parser = createNdjsonParser((value) => {
    if (!isDraftStreamEvent(value)) return;
    if (value.type === "draft") {
      setStreamingDraft({ nodeId, draft: value.draft });
    }
    if (value.type === "done") {
      doneState = value.state;
    }
    if (value.type === "error") {
      throw new Error(value.error);
    }
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
  return doneState;
}
```

Change `ensureNodeDraft` to call stream first:

```ts
const response = await fetch(`/api/sessions/${state.session.id}/draft/generate/stream`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    nodeId,
    ...(note ? { note } : {}),
    ...(optionMode !== "balanced" ? { optionMode } : {})
  })
});
if (response.ok && response.body) {
  const streamedState = await readDraftStream(response as Response, nodeId);
  if (streamedState) return streamedState;
}

const fallbackResponse = await fetch(`/api/sessions/${state.session.id}/draft/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    nodeId,
    ...(note ? { note } : {}),
    ...(optionMode !== "balanced" ? { optionMode } : {})
  })
});
const data = (await fallbackResponse.json()) as { state?: SessionState; error?: string };
if (!fallbackResponse.ok || !data.state) throw new Error(data.error ?? "生成下一版草稿失败。");
return data.state;
```

Clear `streamingDraft` when generation ends:

```ts
finally {
  setPendingChoice(null);
  setGenerationStage(null);
  setStreamingDraft(null);
  setIsBusy(false);
}
```

Use transient drafts in render:

```ts
const streamedDraftForView = streamingDraft?.nodeId === activeViewNodeId ? streamingDraft.draft : null;
const viewedDraft = streamedDraftForView ?? (sessionState ? draftForNode(sessionState, activeViewNodeId) : null);
const isLiveDraftStreaming = Boolean(streamedDraftForView && generationStage?.nodeId === activeViewNodeId && generationStage.stage === "draft");
```

Pass live mode:

```tsx
<LiveDraft
  draft={viewedDraft}
  isLiveDiff={isLiveDraftStreaming}
  previousDraft={previousDraft}
/>
```

- [ ] **Step 5: Run `TreeableApp` tests and verify they pass**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx
git commit -m "feat: read streaming draft updates"
```

---

### Task 6: Final Verification

**Files:**
- Modify only files required by failing verification.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/lib/stream/ndjson.test.ts src/lib/ai/director.test.ts src/lib/ai/director-stream.test.ts 'src/app/api/sessions/[sessionId]/draft/generate/stream/route.test.ts' src/components/draft/LiveDraft.test.tsx src/components/TreeableApp.test.tsx
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

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --stat && git diff --check
```

Expected: `git diff --check` prints no output.

- [ ] **Step 5: Commit verification fixes if any were needed**

If Step 1, Step 2, Step 3, or Step 4 required code changes, run:

```bash
git add src docs
git commit -m "fix: stabilize streaming draft diff"
```

If no fixes were needed, do not create an empty commit.

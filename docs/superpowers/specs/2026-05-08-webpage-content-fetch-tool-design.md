# Webpage Content Fetch Tool Design

Date: 2026-05-08

## Summary

Tritree should give every creation session a default ability to read webpage content when the user provides a URL or asks the AI to reference a page. This ability belongs in the existing Mastra runtime tool layer, not in the user-visible Skill library.

Add a built-in server-side tool named `fetch_webpage_content`. The writer and editor agents can call it when external webpage content is needed. The tool fetches HTTP(S) pages, extracts readable text and metadata, returns a bounded structured result, and lets the existing tool-memory flow preserve useful query results for later rounds.

## Goals

- Make webpage reading available by default in all creation sessions.
- Keep the feature invisible as configuration; users should not need to enable a Skill.
- Let both draft generation and option generation reference webpage content when the task depends on a URL.
- Keep the current Mastra agent and runtime-tool architecture.
- Bound network work with validation, timeout, response-size limits, and output truncation.
- Preserve useful results through existing tool-query memory so later rounds do not refetch the same page unnecessarily.

## Non-Goals

- Do not add a front-end webpage import or preview UI in this pass.
- Do not persist raw webpage snapshots in a new database table.
- Do not crawl multiple pages, follow links recursively, or run browser automation.
- Do not support authenticated pages, JavaScript-rendered content, file downloads, PDFs, images, or videos.
- Do not expose the tool as a user-editable Skill.

## User Experience

The user can paste a URL into their seed, draft, or direction text and ask Tritree to use it. There is no new button or settings panel. During generation, the agent may call the tool if the URL content matters.

Examples:

- "根据这篇文章写一版朋友圈感想：https://example.com/post"
- "帮我参考这个官网的语气，再改一下草稿。"
- "看看这个链接里的产品说明，帮我生成三个写作角度。"

If the page cannot be fetched or parsed, the agent should continue gracefully: mention uncertainty in the generated visible output only when it affects the writing result, and avoid inventing facts from the missing page.

## Architecture

Create a new built-in runtime tool module under `src/lib/ai`, following the existing `createTool` pattern from `@mastra/core/tools`.

Recommended units:

- `src/lib/ai/webpage-content-tool.ts`: tool creation and fetch/extraction helpers.
- `src/lib/ai/webpage-content-tool.test.ts`: focused unit tests.
- `src/lib/ai/mastra-executor.ts`: merge the built-in tool with Skill runtime tools and add its summary to agent context.
- `src/lib/ai/mastra-executor.test.ts`: verify the default tool is injected.
- `src/lib/ai/mastra-context.test.ts`: verify the instruction text exposes the tool summary without making external access unconditional.

The tool should be independent from installed Skills. Existing Skill runtime tools remain conditional on enabled installed Skills; webpage fetching is always present unless a test uses an injected fake agent path that intentionally skips runtime tools.

## Tool Contract

Tool name:

```text
fetch_webpage_content
```

Input:

```ts
{
  url: string;
  maxChars?: number;
}
```

Validation:

- `url` must parse as an absolute URL.
- Only `http:` and `https:` protocols are accepted.
- `maxChars` defaults to a conservative value, such as `8000`.
- `maxChars` should be bounded, for example `1000` to `16000`.

Output:

```ts
{
  ok: boolean;
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string;
  description: string;
  text: string;
  truncated: boolean;
  error?: string;
}
```

The tool should return structured failure results for expected fetch problems rather than crashing the whole agent run. Programmer errors and invalid schema inputs can still throw through normal validation.

## Fetch And Extraction Behavior

Network behavior:

- Use server-side `fetch`.
- Set a timeout with `AbortSignal.timeout` or an equivalent controller.
- Reject or stop reading responses that exceed a configured byte limit.
- Avoid sending user credentials or application secrets.
- Use a clear `User-Agent` identifying Tritree.

Content handling:

- Accept `text/html`, `text/plain`, and closely related textual content types.
- Reject binary and media content types with a structured error.
- Decode response text using the platform response handling.
- For HTML, remove scripts, styles, noscript, SVG, template blocks, and comments.
- Extract `<title>` and common description metadata.
- Convert readable body text to normalized plain text by collapsing whitespace and preserving paragraph-like separation where practical.
- Truncate the returned text to `maxChars` and mark `truncated`.

This is a lightweight extractor, not a full reader-mode engine. It should be deterministic, dependency-light, and good enough for factual reference and writing context.

## Prompting Rules

Add a tool summary to shared agent context:

```text
fetch_webpage_content：获取公开 HTTP/HTTPS 网页的标题、描述和正文文本。只有当用户提供链接、明确要求参考网页、核对网页内容，或当前任务依赖 URL 内容时才调用；如果工具记忆已有同一网页且足够，优先复用已有结果。
```

Existing draft and options instructions already say tools may be called only when listed. Keep that behavior. The summary should make the call condition explicit so agents do not browse casually.

When runtime tools are present, the streaming path already adds final submit tools. `fetch_webpage_content` should participate in that same ReAct flow.

## Tool Memory

The current stream path collects tool transcripts and appends them to `memoryObservation` through `appendToolQueryMemoryObservation`. The webpage tool should produce concise outputs so the transcript is useful without overwhelming session memory.

Expected memory value:

- URL and final URL.
- Title and description when available.
- A bounded excerpt of returned text.
- Error status if fetch failed.

No new database field is needed. Existing `tool_memory` on sessions remains the storage path.

## Error Handling

Expected failure cases should produce `ok: false` with a short `error`:

- unsupported URL protocol
- request timeout
- DNS or network failure
- non-2xx HTTP status
- unsupported content type
- response too large
- empty readable content

Agents should be able to inspect the structured failure and continue. The tool should avoid leaking stack traces into model-visible output.

## Security And Privacy

The first version should be conservative:

- Only fetch absolute public HTTP(S) URLs.
- Reject localhost, loopback, link-local, and private network targets, including IP literals and hostnames that resolve to those ranges.
- Do not include cookies, auth headers, or user-specific credentials.
- Do not execute JavaScript.
- Do not follow arbitrary local file or custom protocols.
- Do not expose raw response headers except basic content type and status.

## Testing

Add focused Vitest tests for:

- Valid HTML pages return title, description, normalized text, and `ok: true`.
- Plain text pages return normalized text.
- Non-HTTP protocols are rejected.
- Non-text content types return `ok: false`.
- Non-2xx responses return `ok: false` with status.
- Long text is truncated and marks `truncated: true`.
- Timeout or fetch rejection returns a structured failure.
- Mastra execution context includes `fetch_webpage_content` by default alongside any Skill runtime tools.
- Prompt context includes the tool summary and still says external access is only available when listed.

## Rollout

This change is server-side only. No migration, UI change, or manual setup is required. Existing tests should continue to pass. After implementation, verify with:

```bash
npm test -- src/lib/ai/webpage-content-tool.test.ts src/lib/ai/mastra-executor.test.ts src/lib/ai/mastra-context.test.ts
npm run typecheck
```

## Open Follow-Ups

- Add redirect-chain host validation if implementation reveals fetch follows redirects before target validation can be repeated.
- Add PDF extraction as a separate capability if users start pasting paper or report links.
- Add a front-end "import from URL" workflow later if users need explicit control over fetched material.

# Streaming Draft Diff Design

Date: 2026-04-27

## Summary

Tritree should generate AI draft nodes with a real streaming response. After a user chooses a direction, the app should keep the parent node's draft visible immediately, then progressively reveal the new draft as an inline diff while the AI response is still arriving.

The streaming experience should be end-to-end: the server must request streaming output from the AI provider, parse the provider event stream, forward incremental draft text to the browser, and persist the completed draft only after the final output validates against the existing draft schema.

## Goals

- Use real provider streaming for AI-generated draft creation.
- Keep the previous node's draft visible throughout generation.
- Show a live parent-to-child diff while the child draft is still partial.
- Persist only complete, schema-valid drafts.
- Preserve the current two-phase node lifecycle: create child node, stream and save draft, then generate the child node's next options.
- Keep existing non-streaming draft generation available as a compatibility path during the migration.

## Non-Goals

- Do not stream option generation in this pass.
- Do not change the saved draft schema.
- Do not persist partial draft snapshots.
- Do not expose raw provider SSE events directly to the React UI.
- Do not add collaborative editing or manual merge tooling beyond the existing diff controls.

## API Design

Add a streaming route:

- `POST /api/sessions/:sessionId/draft/generate/stream`
- Request body: `{ nodeId, note?, optionMode? }`, matching the existing draft generation route.
- Response content type: `application/x-ndjson; charset=utf-8`.
- Response headers should include `X-Content-Type-Options: nosniff` and `Cache-Control: no-cache, no-transform`.

The route should validate the session, target node, parent state, and selected option before opening the provider stream. If the node already has a draft, it can return a `done` event with the current state instead of opening a provider call.

### Stream Events

Each line is one JSON object:

```json
{ "type": "text", "text": "raw accumulated assistant text chunk" }
```

```json
{ "type": "draft", "draft": { "title": "partial title", "body": "partial body", "hashtags": [], "imagePrompt": "" } }
```

```json
{ "type": "done", "state": { "rootMemory": {}, "session": {}, "currentNode": {}, "currentDraft": null, "nodeDrafts": [], "selectedPath": [], "foldedBranches": [], "publishPackage": null } }
```

```json
{ "type": "error", "error": "无法生成下一版草稿。" }
```

The server may emit `text` for raw assistant deltas and `draft` whenever it can derive a useful partial draft. The client should use `draft` events for UI rendering and treat `text` as optional diagnostic/progress data.

## Provider Streaming

The existing Anthropic-compatible request builder should gain a streaming variant that adds `stream: true` to the request body. The server should read the provider response body as SSE and accumulate only visible text deltas:

- Anthropic-compatible events: use `content_block_delta` events whose delta is `text_delta`.
- Ignore `message_start`, `content_block_start`, `content_block_stop`, `message_delta`, ping events, and unknown non-text events.
- Treat provider `error` events and non-2xx responses as generation failures.

The final accumulated assistant text should still go through the existing JSON extraction and `DirectorDraftOutputSchema` parsing before persistence.

## Partial Draft Parsing

AI output remains JSON, so early chunks may not be parseable. Add a small best-effort partial parser that extracts stable fields from the accumulated text:

- `draft.title` when a complete title string is visible.
- `draft.body` as the main live field; it may update repeatedly as text arrives.
- `draft.hashtags` when a complete array is visible.
- `draft.imagePrompt` when a complete image prompt string is visible.

If no structured field can be extracted yet, the client keeps showing the parent draft and the busy state. Once a partial draft is available, the UI uses it as a transient child draft.

Partial parsing must be forgiving but not authoritative. The final persisted draft always comes from the existing strict parser.

## Client Data Flow

`TreeableApp.ensureNodeDraft` should prefer the stream route. It should:

1. Set the generation stage to `{ nodeId, stage: "draft" }`.
2. Keep the viewed draft as the parent draft while the stream starts.
3. Read `response.body` with `ReadableStreamDefaultReader`.
4. Split NDJSON by newline.
5. On `draft`, store a transient streaming draft for `nodeId`.
6. On `done`, clear the transient draft, apply the returned `SessionState`, and continue to option generation.
7. On `error` or stream failure, show the existing friendly error message and leave the child node visible without a persisted draft.

The existing `/draft/generate` route can remain as a fallback if the streaming route is unavailable or returns a non-streaming response body.

## LiveDraft Rendering

`TreeableApp` should pass the transient streaming draft to `LiveDraft` as the displayed draft for the child node while generation is active. It should pass the parent draft as `previousDraft`.

`LiveDraft` should support an explicit live-diff mode so the user does not need to press the "对比" button while generation is active. In this mode:

- Render the parent-to-transient-child inline diff automatically.
- Keep normal edit and diff-edit controls disabled while busy.
- Show a compact status such as `AI 正在生成下一版草稿中`.
- Use the existing diff token styles so additions gradually appear highlighted and removals remain visible from the parent draft.

When the final persisted state arrives, the UI should switch from transient draft to saved draft without clearing the panel.

### Interaction Refinement

The right draft panel should have a stable three-phase interaction during draft generation:

1. Waiting for first partial draft: show the parent draft immediately instead of an empty panel. The panel still enters generated-diff mode so the user can see that the next draft is being written from this baseline.
2. Streaming partial draft: replace the displayed draft with the latest partial draft and render the parent-to-partial diff automatically. The current writing line should be visibly highlighted, with a visible inline cursor at the end of that line. Before any new body text has arrived, the cursor should appear before the parent body text.
3. Review after completion: keep the parent-to-final diff visible after the final draft is persisted and while option generation continues. The diff should remain until the user dismisses it, switches context, edits, or starts another generation.

While streaming, the partial draft is not a complete replacement for the parent draft. Any parent body text beyond the current generated point should render as unchanged text after the cursor, not as removed text. Only text that has actually arrived in the partial draft should be highlighted as generated diff.

The "current generated point" is based on streaming progress, not just textual common prefix. As new body text arrives, the old body placeholder should progressively recede by the covered text length. This prevents the full old draft from staying visible until the stream completes when the new draft starts with different wording.

The draft scroll area should follow the current writing line while streaming so new output remains visible without manual scrolling.

Generated-diff review should not enable inline diff editing. It is an inspection state, not a merge editor.

## Error Handling

- If provider streaming fails before any valid final draft, return an `error` event and do not persist a draft.
- If the provider completes but final JSON parsing fails, return an `error` event and do not persist a draft.
- If persistence fails after successful parsing, return an `error` event.
- If the browser receives a stream `error` event, it should try the existing non-streaming draft generation route before giving up.
- If both streaming and fallback draft generation fail after a child node has been created, the current draft panel should exit the busy state and expose a retry action for that draftless node.
- If the browser stops reading, the route may abort the provider request when practical.
- Friendly API key errors should continue to use the existing `apiKeyMessage` behavior on the client.

## Testing

Unit tests should cover:

- SSE parsing extracts Anthropic-compatible `text_delta` chunks and ignores non-text events.
- NDJSON parsing on the client handles split chunks and multiple lines in one read.
- Partial draft parsing returns useful draft updates from incomplete accumulated JSON without claiming final validity.
- The streaming route sends incremental draft events before the final `done` state and persists only after final parsing.
- `TreeableApp` displays the parent draft first, then passes a transient draft and `previousDraft` to `LiveDraft`.
- `LiveDraft` automatically renders inline diff in live-diff mode without requiring the user to click "对比".
- `TreeableApp` keeps the parent-to-final diff visible after streaming completes until the user dismisses or changes context.
- `LiveDraft` shows a streaming cursor at the body writing point while live draft text is still arriving.

Integration tests should keep the existing non-streaming route assertions so fallback behavior remains covered.

## Rollout Notes

Ship the stream route and client reader behind the normal AI draft generation path, but leave the old route intact. If streaming parsing fails in development, the failure should be visible as a toast and should not corrupt saved tree state.

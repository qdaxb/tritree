# Selected Text AI Edit Design

Date: 2026-04-28

## Summary

Tritree should let the user select text in the visible draft or the normal draft editor, ask AI to rewrite only that selected passage, then automatically replace the selection and save the result as a new custom-edit draft node.

The feature should feel like a lightweight local edit: selection opens a small edit popover, the user describes the desired change, AI returns only the replacement passage, and the existing draft save flow persists the updated full draft. The tree model stays unchanged because the final operation is still a normal submitted draft saved under the existing `自定义编辑` path.

## Goals

- Show an AI edit popover after the user selects text in the draft body display.
- Show the same popover after the user selects text in the normal body editor textarea.
- Send the complete draft, selected field, selected passage, and user instruction to the server.
- Ask the model to return only the replacement passage, not a full rewritten draft.
- Replace the selected passage on the client and call the existing `onSave` path so the result becomes a new custom-edit node.
- Reuse existing busy, save, error, and option-generation behavior where possible.

## Non-Goals

- Do not add preview or manual accept/reject in this pass.
- Do not support title, hashtags, image prompt, diff merge editors, or comparison-only views yet.
- Do not change the persisted draft schema.
- Do not create a separate persisted AI-edit object.
- Do not allow AI to rewrite unselected text.

## User Experience

When the user selects non-empty text in the draft body display, a compact popover appears near the selection. It contains:

- A short preview of the selected passage.
- A textarea for the edit instruction.
- A primary action labeled `发送修改`.
- A secondary close action.

When submitted, the popover enters a loading state and the rest of the draft panel follows the existing busy rules. After the server returns a replacement passage, the client replaces exactly the selected body range, calls `onSave(updatedDraft)`, and lets `TreeableApp.saveDraft` create the new custom-edit child node and generate the next options.

In normal edit mode, selecting text inside the body textarea opens the same popover. The replacement updates the local textarea value first and then calls `onSave(updatedDraft)` immediately. The user does not need to press the normal save button afterward.

If the user clears the selection, clicks outside the popover, changes draft context, enters comparison mode, or starts another operation, the popover closes without changing draft state.

## API Design

Add a route:

- `POST /api/sessions/:sessionId/draft/rewrite-selection`
- Request body:

```json
{
  "nodeId": "current-or-viewed-node-id",
  "draft": {
    "title": "当前标题",
    "body": "完整正文",
    "hashtags": ["#话题"],
    "imagePrompt": "配图提示"
  },
  "field": "body",
  "selectedText": "用户选中的原文",
  "instruction": "用户希望如何修改"
}
```

- Response body:

```json
{ "replacementText": "只用于替换选区的新片段" }
```

The route should validate the session, target node, draft payload, `field`, selected text, and instruction. For this pass, `field` only accepts `body`. The route should focus the session to `nodeId` before building model context so historical-node edits use the correct path and enabled skills.

## AI Prompting

Use the existing Anthropic-compatible Director request utilities where practical, but add a small selection-rewrite prompt instead of reusing the full draft-generation prompt. The prompt should include:

- Current seed and learned preference summary.
- Current path summary.
- Enabled skills.
- Complete current draft.
- Field being edited.
- Exact selected passage.
- User instruction.

The model must return one valid JSON object:

```json
{ "replacementText": "改写后的选区片段" }
```

Prompt constraints:

- Return only replacement text for the selected passage.
- Preserve the language and intent of surrounding draft content.
- Follow enabled skills when relevant.
- Do not include explanations, markdown, or the original full draft.
- Keep Simplified Chinese unless the selected passage itself requires another language.

## Client Data Flow

`LiveDraft` should own selection detection and popover rendering because it already controls both body display and normal edit mode. It should pass the selected body text, selection range, current draft, and instruction to a new callback prop such as `onRewriteSelection`.

`TreeableApp` should implement that callback:

1. Ignore the request when busy or no active viewed node exists.
2. Call `/api/sessions/:sessionId/draft/rewrite-selection`.
3. Receive `replacementText`.
4. Build the updated draft by replacing the selected body range.
5. Call the existing `saveDraft(updatedDraft)`.

This keeps persistence centralized in the current draft route. The rewrite route only generates text; it does not save drafts or create nodes.

## Selection Handling

For body display paragraphs, `LiveDraft` should store the selected body range using known paragraph offsets instead of relying on global document text. This avoids accidental matches from repeated text elsewhere on the page.

For the normal body textarea, `LiveDraft` should use `selectionStart` and `selectionEnd`.

The popover should only appear when:

- The selection is non-empty after trimming.
- The selected text maps to a body range in the currently displayed draft.
- The panel is editable and not busy.
- The panel is not in live diff, comparison, or inline diff mode.

Repeated identical text is allowed because replacement uses the captured numeric range, not `string.replace`.

## Error Handling

- Invalid request payloads return `400` with the existing bad-request helper.
- Missing session or node returns `404`.
- Empty selections or empty instructions return `400`.
- Provider or parsing failures return a friendly public error message.
- Client failures show the existing toast message and keep the original draft unchanged.
- If replacement succeeds but the later save fails, the tree remains unchanged and the normal save error is shown.

## Testing

Unit and component tests should cover:

- `LiveDraft` opens an AI edit popover after selecting body text in display mode.
- `LiveDraft` opens the same popover after selecting body text in normal edit mode.
- Submitting the popover calls the rewrite callback with the selected body range and instruction.
- A returned replacement is inserted at the captured range, not at the first matching text in the body.
- The updated draft is submitted through the existing `onSave` callback.
- The popover is not shown during comparison, live diff streaming, inline diff editing, or busy states.

API and AI tests should cover:

- The rewrite-selection route validates payload shape and rejects unsupported fields.
- The route builds a prompt containing the selected text, instruction, current draft, path context, and enabled skills.
- The route parses `{ replacementText }` and rejects non-JSON or empty replacement responses.
- Provider errors use the existing friendly public error behavior.

Treeable integration tests should cover:

- `TreeableApp` calls the rewrite route for a viewed node.
- After rewrite, it saves the updated draft through `/draft`, creating the same custom-edit child flow as manual edits.
- Rewrite errors do not save partial drafts.

## Rollout Notes

Ship the first pass for body text only. Once the selection popover and replacement-save flow feel stable, the same route shape can extend to title and image prompt by widening the accepted `field` values and adding field-specific selection handling.

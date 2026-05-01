# WeChat Moments Publish Assistant Design

## Summary

Extend the existing `发布助手` in `LiveDraft` with a `朋友圈` tab. The Moments version is body-first: it gives users an editable copy of the draft body without automatically adding a title or hashtags.

This keeps Moments publishing closer to a familiar social feed, where the post should read like a natural note rather than a platform-packaged article.

## Goals

- Add `朋友圈` as a third publish assistant platform next to `微博` and `小红书`.
- Default the Moments text to the current draft body only.
- Let users edit the Moments text before copying.
- Keep image prompt copying available through the existing shared image prompt area.
- Keep the change frontend-only.

## Non-Goals

- Do not post directly to WeChat or open a WeChat login flow.
- Do not add account linking, media upload, or publishing history.
- Do not change AI generation, draft persistence, API routes, or database schema.
- Do not automatically add titles or hashtags to Moments text.

## User Flow

1. User opens `发布助手` from the live draft header.
2. User switches to the `朋友圈` tab.
3. The panel shows one editable `朋友圈文案` text area.
4. The text area is initialized from `draft.body`.
5. User edits the Moments text if needed.
6. User clicks `复制朋友圈文案`.
7. The current edited Moments text is copied and the button temporarily shows `已复制`.
8. If an image prompt exists, user can still copy it from the shared `配图提示` area.

## Platform Formatting

Moments formatted text:

```text
{body}
```

Empty body remains empty. The publish assistant should not derive a title from the body, prepend `draft.title`, or append hashtags for Moments.

## Copy Actions

The `朋友圈` tab has one primary action:

- `复制朋友圈文案`

It copies the current edited `朋友圈文案` text area value. If the value is empty, the copy action does nothing, matching the existing publish copy behavior for empty values.

The shared image action remains unchanged:

- `复制配图提示` appears when the editable image prompt has content.

The `朋友圈` tab does not show `复制标题` or `复制话题`.

## Publish Checks

Checks are informational and never block copying.

Moments checks:

- Show approximate text length: `朋友圈字数约 N`.
- Show `正文已生成` when the edited Moments text has content.
- Show `缺少正文` when the edited Moments text is empty.
- Warn with `朋友圈长文可能需要收紧` when the edited Moments text exceeds 700 characters.
- Show `配图提示可选用` when an image prompt exists.
- Show `朋友圈可以不配图` when no image prompt exists.

## Component Boundary

Keep the feature inside `LiveDraft`, following the current publish assistant implementation:

- Extend `PublishPlatform` to include `moments`.
- Extend `PublishTextByPlatform` state to store editable Moments text.
- Extend platform labels, primary copy action, copy labels, formatting helper, secondary actions, and publish checks.
- Reuse the existing clipboard helper and copy success/error state.

No new shared component is required for this small extension.

## Dialog Behavior

The existing dialog lifecycle remains unchanged:

- Opening `发布助手` initializes editable publish fields from the visible draft.
- Switching platforms clears copy success and copy error state.
- Draft changes, edit mode, comparison mode, or live diff review close the dialog as they do today.

## Error Handling

- Clipboard failures show the existing inline error: `复制失败，请手动选中文案复制。`
- Empty Moments text does not crash and does not attempt to copy.
- Missing image prompt only affects the informational check.

## Accessibility

- `朋友圈` is exposed as a platform button in the existing `发布平台` group.
- The Moments text area has the accessible label `朋友圈文案`.
- The primary copy button is labelled `复制朋友圈文案`.
- Existing dialog role and accessible label remain unchanged.

## Testing

Add focused tests for:

- `发布助手` shows `朋友圈` as a third platform tab.
- Switching to `朋友圈` shows an editable `朋友圈文案` text area.
- The default Moments text equals `draft.body` only.
- The Moments text does not include `draft.title` or hashtags.
- `复制朋友圈文案` copies user edits from the Moments text area.
- `朋友圈` does not render `复制标题` or `复制话题`.
- Moments checks show body status, approximate length, long-text warning, and image prompt status.
- Existing Weibo and Xiaohongshu behavior stays covered.

# Platform Publish Assistant Design

## Summary

Add a lightweight publish assistant to the live draft panel. The assistant helps users quickly copy generated content for Weibo and Xiaohongshu without automating cross-site posting or requiring platform login.

The entry point is a single `发布` button in the `LiveDraft` header. Clicking it opens a small publish dialog outside the draft scroll area. The dialog uses platform tabs so each platform has its own preview, checks, and copy actions.

## Goals

- Make generated content fast to move into Weibo or Xiaohongshu.
- Keep the current writing, editing, diff, and skill controls uncluttered.
- Show the exact editable text that will be copied before copying.
- Provide lightweight platform-specific readiness checks without blocking the user.
- Avoid direct posting, login, permissions, account linking, or uploading.

## User Flow

1. User finishes or reviews a draft in the live draft panel.
2. User clicks `发布` in the draft panel header.
3. A `发布助手` dialog opens.
4. The dialog defaults to the `微博` tab.
5. User can switch between `微博` and `小红书`.
6. Each tab shows an editable formatted text box for that platform.
7. User can lightly edit the platform text in the dialog.
8. User clicks the primary copy action:
   - `复制微博文案` on the Weibo tab.
   - `复制小红书文案` on the Xiaohongshu tab.
9. The copied button temporarily changes to `已复制`.
10. User pastes the copied text into the target platform manually.

## Live Draft Header

Add `发布` to the existing `draft-panel__actions` cluster. It should sit near `编辑` and `对比`, because it is an action on the current draft.

The button is disabled when:

- There is no visible draft.
- The app is busy generating or saving.
- The panel is showing a comparison rather than a single draft.

The button stays visible for current and historical drafts if a draft exists, because users may want to publish an earlier version.

## Publish Dialog

The dialog is rendered outside `.draft-panel__scroll`, like the skills popover, so it is not affected by long draft scrolling. It should be visually compact and anchored near the header action area.

Dialog structure:

- Header: `发布助手`, short subcopy `生成适合平台的复制版本`, close button.
- Platform tabs: `微博`, `小红书`.
- Editable platform text box: exact text that will be copied for the active tab.
- Image prompt box: visible `配图提示` content with a copy action when present.
- Copy actions for the active tab.
- Platform checks for the active tab.

The dialog closes when:

- User clicks close.
- User opens another mutually exclusive header popover, such as skills.
- The visible draft changes.
- The draft enters edit mode, comparison mode, or live diff review.

## Platform Formatting

Use the current `Draft` shape: `title`, `body`, `hashtags`, `imagePrompt`.

Weibo formatted text:

```text
{title}

{body}

{Weibo topics separated by spaces, formatted as #话题#}
```

If the title is empty after fallback resolution, omit the title block. If there are no hashtags, omit the hashtag block.

Xiaohongshu formatted text:

```text
{title}

{body}

{Xiaohongshu topics separated by spaces, formatted as #话题}
```

The initial formatting can match Weibo structurally, but Xiaohongshu gets different checks and copy actions because title and topic handling matter more there. Future iterations can add Xiaohongshu-specific title/body splitting if the product starts storing platform variants.

Hashtag normalization:

- Trim empty tags and remove leading/trailing `#` before formatting.
- Format Weibo topics as `#话题#`.
- Format Xiaohongshu topics as `#话题`.
- Join tags with a single space.

## Copy Actions

Weibo tab:

- Primary: `复制微博文案`.
- Secondary: `复制正文`.
- Secondary: `复制话题` when hashtags exist.
- Separate image action: `复制配图提示` when an image prompt exists.

Xiaohongshu tab:

- Primary: `复制小红书文案`.
- Secondary: `复制标题` when a title exists.
- Secondary: `复制正文`.
- Secondary: `复制话题` when hashtags exist.
- Separate image action: `复制配图提示` when an image prompt exists.

Copy success state:

- The primary platform copy action copies the current edited text box value, not the original generated text.
- The clicked button label changes to `已复制`.
- The success state resets after a short delay or when switching tabs.
- Clipboard errors show a small inline message: `复制失败，请手动选中文案复制。`

## Publish Checks

Checks are informational and never block copying.

Shared checks:

- Title exists.
- Body exists.
- Hashtags exist.
- Hashtags use the active platform format.
- Image prompt exists.

Weibo checks:

- Show approximate character count for the current edited text box value.
- Warn when formatted text is long for Weibo.
- Treat missing image prompt as neutral, because Weibo can be text-only.

Xiaohongshu checks:

- Show title length.
- Warn when title is missing.
- Warn when no hashtags exist.
- Suggest using the image prompt for cover or image generation if present.
- Warn when image prompt is missing, because Xiaohongshu usually benefits from visuals.

## Component Boundary

Keep this feature inside the draft component boundary unless implementation reveals shared needs.

Recommended units:

- `LiveDraft` owns dialog visibility and active platform tab.
- Pure helper functions format platform text and build checks.
- Clipboard helper reuses the existing `copyTextToClipboard` behavior.

The first implementation does not need new API routes, database fields, or AI generation changes.

## Error Handling

- Clipboard failures do not crash the panel.
- Empty or missing fields degrade gracefully by omitting empty blocks.
- Checks explain missing fields without preventing copy.
- If no draft is available, the publish button is disabled rather than showing an empty dialog.

## Accessibility

- `发布` is a button with `aria-expanded` when the dialog is open.
- The dialog has an accessible label such as `发布助手`.
- Platform tabs use tab semantics or equivalent accessible buttons with `aria-pressed`.
- Copy buttons have explicit labels that name the platform or field.
- Close button has `aria-label="关闭发布助手"`.

## Testing

Add focused tests for:

- The `发布` button appears for a visible draft and opens the dialog.
- The dialog switches between `微博` and `小红书`.
- Weibo primary copy writes the formatted Weibo text.
- Xiaohongshu primary copy writes the formatted Xiaohongshu text.
- Xiaohongshu shows `复制标题`; Weibo does not need that action.
- Weibo hashtags are normalized as `#话题#`.
- Xiaohongshu hashtags are normalized as `#话题`.
- The primary copy action uses user edits from the platform text box.
- The image prompt is visible in the publish assistant and can be copied.
- Copy success state appears after a successful copy.
- The dialog closes when the draft changes or edit mode starts.
- Clipboard failure shows an inline error message.

## Out Of Scope

- Posting directly to Weibo or Xiaohongshu.
- Opening platform login flows.
- Uploading images.
- Generating images from `imagePrompt`.
- Persisting platform-specific publish history.
- Creating separate AI-generated platform variants.

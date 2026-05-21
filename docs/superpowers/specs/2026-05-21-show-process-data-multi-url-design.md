# show_process_data Multi-URL Design

## Context

`show_process_data` currently accepts one clickable source per process item through `items[].url`, with `source_url` and `sourceUrl` accepted as aliases. The executor schema normalizes those aliases to `url`, and the artifact workspace renders the item title as a single source link.

Some process items are backed by multiple source pages. The tool needs to preserve and render more than one source URL without breaking existing tool calls or historical node data.

## Design

Add multi-source URL support at the process item level with a canonical `urls` array:

```ts
{
  title: string;
  subtitle?: string;
  meta?: string;
  url?: string;
  urls?: string[];
}
```

The canonical multi-source field is `urls`. The schema and UI also accept `source_urls` and `sourceUrls` as input aliases. Existing single-source fields `url`, `source_url`, and `sourceUrl` remain supported.

Normalization rules:

1. Trim every URL string.
2. Preserve input order.
3. Remove empty values.
4. Prefer explicit `urls` over alias arrays.
5. Include a legacy single URL when no array is provided, so old tool calls become `urls: [url]`.
6. Keep `url` for backward compatibility when a single URL exists, using the first normalized URL.

## UI Behavior

The artifact workspace renders source links separately from the title so one item can show multiple links. A single source keeps the existing visual language. Multiple sources render as compact links labeled `来源 1`, `来源 2`, and so on, each opening in a new tab.

Items without URLs continue to render as plain text.

## Prompt Guidance

Tool descriptions and system skill defaults should mention `items[].urls` for multi-source material while continuing to allow `items[].url` for one source. The guidance should make clear that source-backed items need clickable URLs, either as `url` or `urls`.

## Testing

Add schema tests for:

- canonical `urls`
- `source_urls` and `sourceUrls` aliases
- fallback from legacy `url`
- first URL mirrored to `url`

Add artifact workspace tests for:

- rendering multiple source links for one process item
- preserving legacy single-link rendering

Run the focused schema and workspace tests, then run typecheck if the focused tests pass.

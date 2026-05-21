# show_process_data Multi-URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support multiple clickable source URLs per `show_process_data` process item while preserving existing single-URL calls and historical data.

**Architecture:** Extend the canonical process item shape with `urls?: string[]` while mirroring the first normalized source into `url` for compatibility. Keep normalization close to existing schema/parser boundaries, and render links from normalized `urls` in the artifact workspace.

**Tech Stack:** TypeScript, React 19, Zod 3, Vitest, Testing Library.

---

## File Structure

- Modify `src/lib/ai/mastra-executor/schemas.ts`: canonical executor validation and normalization for `urls`, `source_urls`, `sourceUrls`, and legacy single URL aliases.
- Modify `src/lib/ai/mastra-executor/schemas.test.ts`: schema red/green tests for multi-source normalization.
- Modify `src/lib/ai/mastra-executor/stream-chunks.ts`: preserve streaming partial `urls` arrays while parsing tool-call deltas.
- Modify `src/lib/ai/mastra-executor.test.ts`: streaming regression for `urls` in a delta-built `show_process_data` call.
- Modify `src/components/artifacts/ArtifactWorkspace.tsx`: process material item type, historical data parsing, and multi-link rendering.
- Modify `src/components/artifacts/ArtifactWorkspace.test.tsx`: workspace rendering tests for multiple links and legacy compatibility.
- Modify `src/app/globals.css`: small layout styles for compact multiple source links.
- Modify `src/lib/ai/mastra-executor/tools.ts`, `src/lib/defaults.test.ts`, `config/defaults.example.json`, `src/lib/ai/subagent-templates.ts`, and related prompt tests if current assertions require prompt text updates.

## Task 1: Executor Schema Normalization

**Files:**
- Modify: `src/lib/ai/mastra-executor/schemas.ts`
- Test: `src/lib/ai/mastra-executor/schemas.test.ts`

- [ ] **Step 1: Write the failing schema test**

Add this test case to `src/lib/ai/mastra-executor/schemas.test.ts`:

```ts
it("normalizes multiple process material source URLs", () => {
  const parsed = ShowProcessDataInputSchema.parse({
    title: "参考材料",
    sourceToolCallIds: ["tool-1"],
    items: [
      { title: "参考条目 A", urls: [" https://example.com/a ", "", "https://example.com/b"] },
      { title: "参考条目 B", source_urls: ["https://example.com/c"] },
      { title: "参考条目 C", sourceUrls: ["https://example.com/d", "https://example.com/e"] },
      { title: "参考条目 D", url: "https://example.com/f" }
    ]
  });

  expect(parsed.items).toEqual([
    { title: "参考条目 A", url: "https://example.com/a", urls: ["https://example.com/a", "https://example.com/b"] },
    { title: "参考条目 B", url: "https://example.com/c", urls: ["https://example.com/c"] },
    { title: "参考条目 C", url: "https://example.com/d", urls: ["https://example.com/d", "https://example.com/e"] },
    { title: "参考条目 D", url: "https://example.com/f", urls: ["https://example.com/f"] }
  ]);
});
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run: `npm test -- src/lib/ai/mastra-executor/schemas.test.ts`

Expected: FAIL because `urls`, `source_urls`, and `sourceUrls` are rejected by the strict process item schema.

- [ ] **Step 3: Implement minimal schema support**

In `src/lib/ai/mastra-executor/schemas.ts`, add `urls: z.array(z.string().trim().min(1).max(1000)).max(10).optional()` to the item schema and update `normalizeProcessDataDisplayItem` to:

```ts
const urls = stringArrayField(record, "urls")
  ?? stringArrayField(record, "source_urls")
  ?? stringArrayField(record, "sourceUrls")
  ?? (url ? [url] : []);
const normalizedUrl = urls[0] ?? url;
return {
  ...rest,
  ...(normalizedUrl ? { url: normalizedUrl } : {}),
  ...(urls.length > 0 ? { urls } : {})
};
```

Add a local helper:

```ts
function stringArrayField(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return strings.length > 0 ? strings : undefined;
}
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `npm test -- src/lib/ai/mastra-executor/schemas.test.ts`

Expected: PASS.

## Task 2: Streaming Tool-Call Delta Preservation

**Files:**
- Modify: `src/lib/ai/mastra-executor/stream-chunks.ts`
- Test: `src/lib/ai/mastra-executor.test.ts`

- [ ] **Step 1: Write the failing streaming test**

In the existing `streams process data display while show_process_data arguments arrive in deltas` test in `src/lib/ai/mastra-executor.test.ts`, change the final argument delta so the first item includes:

```json
"urls":["https://example.com/a","https://example.com/a2"]
```

Then assert the emitted `process_data` item contains both URLs:

```ts
expect(processDataEvents[0]?.data.items[0]).toMatchObject({
  title: "参考条目 A",
  urls: ["https://example.com/a", "https://example.com/a2"],
  url: "https://example.com/a"
});
```

- [ ] **Step 2: Run the focused executor streaming test to verify it fails**

Run: `npm test -- src/lib/ai/mastra-executor.test.ts -t "streams process data display while show_process_data arguments arrive in deltas"`

Expected: FAIL because `stream-chunks.ts` currently only carries `value.url`.

- [ ] **Step 3: Preserve `urls` in streamed process item candidates**

Update `processDataDisplayItemFromValue` in `src/lib/ai/mastra-executor/stream-chunks.ts` to include:

```ts
...(stringArrayValue(value.urls).length > 0 ? { urls: stringArrayValue(value.urls) } : {}),
...(typeof value.source_urls !== "undefined" && stringArrayValue(value.source_urls).length > 0 ? { urls: stringArrayValue(value.source_urls) } : {}),
...(typeof value.sourceUrls !== "undefined" && stringArrayValue(value.sourceUrls).length > 0 ? { urls: stringArrayValue(value.sourceUrls) } : {}),
```

Keep the final normalization delegated to `ShowProcessDataInputSchema.safeParse(candidate)`.

- [ ] **Step 4: Run the focused executor streaming test to verify it passes**

Run: `npm test -- src/lib/ai/mastra-executor.test.ts -t "streams process data display while show_process_data arguments arrive in deltas"`

Expected: PASS.

## Task 3: Artifact Workspace Rendering

**Files:**
- Modify: `src/components/artifacts/ArtifactWorkspace.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/artifacts/ArtifactWorkspace.test.tsx`

- [ ] **Step 1: Write the failing workspace test**

Add a process material item with two URLs in `shows process materials explicitly submitted by the display tool`:

```ts
{
  title: "参考条目 C",
  subtitle: "方向 C",
  urls: ["https://example.com/c1", "https://example.com/c2"]
}
```

Assert:

```ts
expect(screen.getByText("参考条目 C")).toBeInTheDocument();
expect(screen.getByRole("link", { name: "参考条目 C 来源 1" })).toHaveAttribute("href", "https://example.com/c1");
expect(screen.getByRole("link", { name: "参考条目 C 来源 2" })).toHaveAttribute("href", "https://example.com/c2");
expect(screen.getByRole("link", { name: "参考条目 A 来源" })).toHaveAttribute("href", "https://example.com/a");
```

- [ ] **Step 2: Run the workspace test to verify it fails**

Run: `npm test -- src/components/artifacts/ArtifactWorkspace.test.tsx -t "shows process materials explicitly submitted by the display tool"`

Expected: FAIL because the workspace parser and renderer only know `url`.

- [ ] **Step 3: Implement multi-link parsing and rendering**

Update `ProcessMaterialItem` with `urls?: string[]`.

Update `processMaterialItemFromValue` to derive normalized URLs from `urls`, `source_urls`, `sourceUrls`, or legacy single URL fields:

```ts
const urls = stringArrayField(value, "urls")
  ?? stringArrayField(value, "source_urls")
  ?? stringArrayField(value, "sourceUrls")
  ?? (url ? [url] : []);
```

Render the title as text, then render source links after it:

```tsx
<span>{item.title}</span>
{item.urls?.length ? (
  <span className="artifact-workspace__material-link-list">
    {item.urls.map((sourceUrl, sourceIndex) => (
      <a
        aria-label={`${item.title} ${item.urls && item.urls.length > 1 ? `来源 ${sourceIndex + 1}` : "来源"}`}
        className="artifact-workspace__material-link-source"
        href={sourceUrl}
        key={`${sourceUrl}-${sourceIndex}`}
        rel="noreferrer"
        target="_blank"
      >
        {item.urls && item.urls.length > 1 ? `来源 ${sourceIndex + 1}` : "来源"}
        <ExternalLink aria-hidden="true" size={12} strokeWidth={2.2} />
      </a>
    ))}
  </span>
) : null}
```

Keep `url` populated with the first URL for compatibility.

Add CSS for `.artifact-workspace__material-link-list` and adjust existing link rules so multiple compact source anchors wrap cleanly.

- [ ] **Step 4: Run the workspace test to verify it passes**

Run: `npm test -- src/components/artifacts/ArtifactWorkspace.test.tsx -t "shows process materials explicitly submitted by the display tool"`

Expected: PASS.

## Task 4: Prompt Guidance And Full Verification

**Files:**
- Modify: `src/lib/ai/mastra-executor/tools.ts`
- Modify: `config/defaults.example.json`
- Modify: `src/lib/defaults.test.ts`
- Modify: `src/lib/ai/subagent-templates.ts`
- Test: `src/lib/defaults.test.ts`, `src/lib/ai/subagent-templates.test.ts`, `src/lib/ai/subagent-runtime.test.ts`, `src/lib/ai/mastra-executor.test.ts`

- [ ] **Step 1: Write failing prompt assertions**

Update assertions so relevant prompt tests require both single-source and multi-source guidance:

```ts
expect(systemSkillsById.get("system-researcher")?.prompt).toContain("items[].url or items[].urls");
expect(systemSkillsById.get("system-researcher")?.prompt).toContain("multiple source URLs");
```

In `src/lib/ai/mastra-executor.test.ts`, change instruction expectations to include:

```ts
expect(constructedOptions.instructions).toContain("items[].url or items[].urls");
```

- [ ] **Step 2: Run prompt tests to verify they fail**

Run: `npm test -- src/lib/defaults.test.ts src/lib/ai/subagent-templates.test.ts src/lib/ai/subagent-runtime.test.ts src/lib/ai/mastra-executor.test.ts -t "show_process_data|system skills|subagent"`

Expected: FAIL where prompt text still only mentions `items[].url`.

- [ ] **Step 3: Update prompt guidance**

Update prompt strings to say source-backed process items must include clickable URLs in `items[].url` for one source or `items[].urls` for multiple sources. Keep existing instructions about `meta` not being a citation substitute.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- src/lib/ai/mastra-executor/schemas.test.ts src/components/artifacts/ArtifactWorkspace.test.tsx src/lib/defaults.test.ts src/lib/ai/subagent-templates.test.ts src/lib/ai/subagent-runtime.test.ts src/lib/ai/mastra-executor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit implementation**

```bash
git add src/lib/ai/mastra-executor/schemas.ts src/lib/ai/mastra-executor/schemas.test.ts src/lib/ai/mastra-executor/stream-chunks.ts src/lib/ai/mastra-executor.test.ts src/components/artifacts/ArtifactWorkspace.tsx src/components/artifacts/ArtifactWorkspace.test.tsx src/app/globals.css src/lib/ai/mastra-executor/tools.ts src/lib/defaults.test.ts config/defaults.example.json src/lib/ai/subagent-templates.ts src/lib/ai/subagent-templates.test.ts src/lib/ai/subagent-runtime.test.ts docs/superpowers/plans/2026-05-21-show-process-data-multi-url-implementation.md
git commit -m "Support multiple show_process_data source URLs"
```

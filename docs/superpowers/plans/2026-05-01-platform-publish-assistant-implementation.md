# Platform Publish Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `发布` assistant to the live draft panel so users can switch between Weibo and Xiaohongshu previews and quickly copy platform-ready text.

**Architecture:** Keep the feature inside `LiveDraft` because it only depends on the visible `Draft`. Add small pure helpers in `LiveDraft.tsx` for hashtag normalization, platform text formatting, and readiness checks, while `LiveDraft` owns dialog state, active tab, copy status, and clipboard errors.

**Tech Stack:** Next.js client component, React state/effects, Vitest, Testing Library, existing browser clipboard helper.

---

## File Structure

- Modify `src/components/draft/LiveDraft.tsx`
  - Add publish assistant state.
  - Add helper types and pure functions near the existing draft helpers.
  - Render the `发布` header button and publish dialog.
  - Reuse `copyTextToClipboard`.
- Modify `src/components/draft/LiveDraft.test.tsx`
  - Add focused tests for dialog opening, tab switching, copy actions, hashtag normalization, success state, clipboard failure, and close behavior.
- Modify `src/app/globals.css`
  - Add compact publish dialog, tab, preview, action, and check styles.

No new API routes, database schema, or domain types are needed.

---

### Task 1: Dialog Shell And Platform Tabs

**Files:**
- Modify: `src/components/draft/LiveDraft.test.tsx`
- Modify: `src/components/draft/LiveDraft.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write the failing dialog shell test**

Append this test inside `describe("LiveDraft", () => { ... })` in `src/components/draft/LiveDraft.test.tsx`:

```tsx
  it("opens a publish assistant with Weibo and Xiaohongshu tabs", async () => {
    render(
      <LiveDraft
        draft={{
          title: "把复杂工作讲成一句人话",
          body: "先给对方一条主线，再补细节。",
          hashtags: ["产品思考", "#沟通效率"],
          imagePrompt: "一张干净的工作台"
        }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));

    expect(screen.getByRole("dialog", { name: "发布助手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "微博" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "小红书" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("微博版预览")).toBeInTheDocument();
    expect(screen.getByText(/#产品思考 #沟通效率/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "小红书" }));

    expect(screen.getByRole("button", { name: "微博" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "小红书" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("小红书版预览")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the shell test and verify it fails**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "opens a publish assistant"
```

Expected: FAIL because there is no `发布` button or `发布助手` dialog yet.

- [ ] **Step 3: Add publish state and helper types**

In `src/components/draft/LiveDraft.tsx`, extend the lucide import and add state near the existing `useState` calls:

```tsx
import { Copy, ImagePlus, Send, Sparkles, X } from "lucide-react";
```

```tsx
  const [isPublishPanelOpen, setIsPublishPanelOpen] = useState(false);
  const [activePublishPlatform, setActivePublishPlatform] = useState<PublishPlatform>("weibo");
  const [copiedPublishAction, setCopiedPublishAction] = useState<PublishCopyAction | null>(null);
  const [publishCopyError, setPublishCopyError] = useState("");
```

Add these types near the other local type aliases:

```tsx
type PublishPlatform = "weibo" | "xiaohongshu";
type PublishCopyAction = "weibo" | "xiaohongshu" | "title" | "body" | "hashtags";
```

- [ ] **Step 4: Add formatting helpers**

Add these helper functions near `parseHashtags`:

```tsx
function normalizedHashtags(hashtags: string[]) {
  return hashtags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
}

function formatPublishText(draft: Draft, platform: PublishPlatform) {
  const title = resolveDraftTitle(draft.title, draft.body).trim();
  const body = draft.body.trim();
  const hashtags = normalizedHashtags(draft.hashtags).join(" ");
  return [title, body, hashtags].filter(Boolean).join("\n\n");
}

function publishPlatformLabel(platform: PublishPlatform) {
  return platform === "weibo" ? "微博" : "小红书";
}
```

The `platform` argument is intentionally present even though both platforms use the same first-pass text structure. It keeps the call sites explicit and gives later platform-specific formatting a stable boundary.

- [ ] **Step 5: Render the publish button and dialog shell**

Inside the header action cluster in `LiveDraft.tsx`, before the diff and edit controls, add:

```tsx
          {content && !isComparisonMode ? (
            <button
              aria-expanded={isPublishPanelOpen}
              className="draft-publish-button"
              disabled={isBusy}
              onClick={() => {
                setPublishCopyError("");
                setCopiedPublishAction(null);
                setIsPublishPanelOpen((open) => !open);
              }}
              type="button"
            >
              <Send aria-hidden="true" size={13} />
              <span>发布</span>
            </button>
          ) : null}
```

After `{headerPanel ? ... : null}`, render the publish dialog:

```tsx
      {isPublishPanelOpen && content ? (
        <aside aria-label="发布助手" className="draft-publish-panel" role="dialog">
          <div className="draft-publish-panel__header">
            <div>
              <p className="draft-publish-panel__title">发布助手</p>
              <p className="draft-publish-panel__copy">生成适合平台的复制版本</p>
            </div>
            <button
              aria-label="关闭发布助手"
              className="draft-publish-panel__close"
              onClick={() => setIsPublishPanelOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
          <div aria-label="发布平台" className="draft-publish-tabs" role="group">
            {(["weibo", "xiaohongshu"] as const).map((platform) => (
              <button
                aria-pressed={activePublishPlatform === platform}
                key={platform}
                onClick={() => {
                  setActivePublishPlatform(platform);
                  setPublishCopyError("");
                  setCopiedPublishAction(null);
                }}
                type="button"
              >
                {publishPlatformLabel(platform)}
              </button>
            ))}
          </div>
          <section className="draft-publish-preview" aria-label={`${publishPlatformLabel(activePublishPlatform)}版预览`}>
            <div className="draft-publish-preview__meta">
              <span>{publishPlatformLabel(activePublishPlatform)}版预览</span>
              <span>约 {formatPublishText(content, activePublishPlatform).length} 字</span>
            </div>
            <pre>{formatPublishText(content, activePublishPlatform)}</pre>
          </section>
        </aside>
      ) : null}
```

- [ ] **Step 6: Add minimal styles**

Append these styles near the existing `.draft-panel__popover` and header action styles in `src/app/globals.css`:

```css
.draft-publish-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  color: #0f766e;
  font-size: 0.76rem;
  font-weight: 850;
  background: #ccfbf1;
  border: 0;
  border-radius: 8px;
}

.draft-publish-button[aria-expanded="true"] {
  color: #102033;
  background: #e0f2fe;
}

.draft-publish-panel {
  position: absolute;
  top: 48px;
  right: 18px;
  z-index: 5;
  width: min(380px, calc(100% - 36px));
  display: grid;
  gap: 12px;
  padding: 14px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 8px;
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18);
}

.draft-publish-panel__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.draft-publish-panel__title,
.draft-publish-panel__copy {
  margin: 0;
}

.draft-publish-panel__title {
  color: var(--ink);
  font-size: 0.92rem;
  font-weight: 900;
}

.draft-publish-panel__copy {
  margin-top: 3px;
  color: var(--muted);
  font-size: 0.78rem;
}

.draft-publish-panel__close {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: #64748b;
  background: #f1f5f9;
  border: 0;
  border-radius: 999px;
}

.draft-publish-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  background: #eef2f6;
  border-radius: 8px;
}

.draft-publish-tabs button {
  min-height: 34px;
  color: #475569;
  font-size: 0.82rem;
  font-weight: 850;
  background: transparent;
  border: 0;
  border-radius: 6px;
}

.draft-publish-tabs button[aria-pressed="true"] {
  color: #0f766e;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}

.draft-publish-preview {
  display: grid;
  gap: 8px;
  padding: 11px;
  background: #fbfcfc;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 8px;
}

.draft-publish-preview__meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: #475569;
  font-size: 0.76rem;
  font-weight: 850;
}

.draft-publish-preview pre {
  max-height: 150px;
  margin: 0;
  overflow: auto;
  color: #334155;
  font: inherit;
  font-size: 0.84rem;
  line-height: 1.58;
  white-space: pre-wrap;
}
```

- [ ] **Step 7: Run the shell test and verify it passes**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "opens a publish assistant"
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/components/draft/LiveDraft.tsx src/components/draft/LiveDraft.test.tsx src/app/globals.css
git commit -m "feat: add publish assistant shell"
```

---

### Task 2: Platform Copy Actions

**Files:**
- Modify: `src/components/draft/LiveDraft.test.tsx`
- Modify: `src/components/draft/LiveDraft.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write the failing copy tests**

Append these tests inside `describe("LiveDraft", () => { ... })`:

```tsx
  it("copies the formatted Weibo text with normalized hashtags", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <LiveDraft
        draft={{
          title: "标题",
          body: "正文第一句。\n正文第二句。",
          hashtags: ["产品思考", "#沟通效率"],
          imagePrompt: ""
        }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    await userEvent.click(screen.getByRole("button", { name: "复制微博文案" }));

    expect(writeText).toHaveBeenCalledWith("标题\n\n正文第一句。\n正文第二句。\n\n#产品思考 #沟通效率");
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  });

  it("offers Xiaohongshu-specific copy actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <LiveDraft
        draft={{ title: "小红书标题", body: "小红书正文", hashtags: ["生活观察"], imagePrompt: "封面图" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.queryByRole("button", { name: "复制标题" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "小红书" }));
    await userEvent.click(screen.getByRole("button", { name: "复制标题" }));

    expect(writeText).toHaveBeenCalledWith("小红书标题");
    expect(screen.getByRole("button", { name: "复制小红书文案" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制正文" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制话题" })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the copy tests and verify they fail**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "copies the formatted Weibo text|offers Xiaohongshu-specific copy actions"
```

Expected: FAIL because copy buttons do not exist yet.

- [ ] **Step 3: Add copy value helpers**

Add these helpers near `formatPublishText` in `LiveDraft.tsx`:

```tsx
function publishCopyValue(draft: Draft, platform: PublishPlatform, action: PublishCopyAction) {
  if (action === "body") return draft.body.trim();
  if (action === "title") return resolveDraftTitle(draft.title, draft.body).trim();
  if (action === "hashtags") return normalizedHashtags(draft.hashtags).join(" ");
  return formatPublishText(draft, platform);
}

function publishPrimaryActionFor(platform: PublishPlatform): PublishCopyAction {
  return platform === "weibo" ? "weibo" : "xiaohongshu";
}

function publishCopyLabel(platform: PublishPlatform, action: PublishCopyAction) {
  if (action === "weibo") return "复制微博文案";
  if (action === "xiaohongshu") return "复制小红书文案";
  if (action === "title") return "复制标题";
  if (action === "body") return "复制正文";
  return "复制话题";
}

function secondaryPublishActionsFor(draft: Draft, platform: PublishPlatform): PublishCopyAction[] {
  const actions: PublishCopyAction[] = [];
  if (platform === "xiaohongshu" && resolveDraftTitle(draft.title, draft.body).trim()) actions.push("title");
  if (draft.body.trim()) actions.push("body");
  if (normalizedHashtags(draft.hashtags).length) actions.push("hashtags");
  return actions;
}
```

- [ ] **Step 4: Add the copy handler**

Inside the `LiveDraft` component, add:

```tsx
  async function copyPublishText(action: PublishCopyAction) {
    if (!content) return;

    const value = publishCopyValue(content, activePublishPlatform, action);
    if (!value) return;

    try {
      await copyTextToClipboard(value);
      setPublishCopyError("");
      setCopiedPublishAction(action);
      window.setTimeout(() => {
        setCopiedPublishAction((current) => (current === action ? null : current));
      }, 1400);
    } catch {
      setCopiedPublishAction(null);
      setPublishCopyError("复制失败，请手动选中文案复制。");
    }
  }
```

- [ ] **Step 5: Render copy action buttons**

Inside the publish dialog after the preview section, add:

```tsx
          <div className="draft-publish-actions">
            {[publishPrimaryActionFor(activePublishPlatform), ...secondaryPublishActionsFor(content, activePublishPlatform)].map(
              (action) => (
                <button
                  className={action === publishPrimaryActionFor(activePublishPlatform) ? "draft-publish-actions__primary" : undefined}
                  key={action}
                  onClick={() => void copyPublishText(action)}
                  type="button"
                >
                  <Copy aria-hidden="true" size={13} />
                  <span>{copiedPublishAction === action ? "已复制" : publishCopyLabel(activePublishPlatform, action)}</span>
                </button>
              )
            )}
          </div>
          {publishCopyError ? (
            <p className="draft-publish-error" role="status">
              {publishCopyError}
            </p>
          ) : null}
```

- [ ] **Step 6: Add copy action styles**

Append to `src/app/globals.css`:

```css
.draft-publish-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.draft-publish-actions button {
  min-width: 0;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 9px;
  color: #075985;
  font-size: 0.78rem;
  font-weight: 850;
  background: #e0f2fe;
  border: 1px solid rgba(14, 116, 144, 0.18);
  border-radius: 8px;
}

.draft-publish-actions__primary {
  grid-column: 1 / -1;
  color: #ffffff !important;
  background: #2563eb !important;
  border-color: #2563eb !important;
}

.draft-publish-error {
  margin: 0;
  color: #9a3412;
  font-size: 0.78rem;
  line-height: 1.4;
}
```

- [ ] **Step 7: Run the copy tests and verify they pass**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "copies the formatted Weibo text|offers Xiaohongshu-specific copy actions"
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/components/draft/LiveDraft.tsx src/components/draft/LiveDraft.test.tsx src/app/globals.css
git commit -m "feat: copy platform publish text"
```

---

### Task 3: Platform Checks And Close Behavior

**Files:**
- Modify: `src/components/draft/LiveDraft.test.tsx`
- Modify: `src/components/draft/LiveDraft.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write failing checks and close tests**

Append these tests inside `describe("LiveDraft", () => { ... })`:

```tsx
  it("shows platform-specific publish checks without blocking copy", async () => {
    render(
      <LiveDraft
        draft={{ title: "", body: "只有正文", hashtags: [], imagePrompt: "" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));

    expect(screen.getByText(/微博字数约/)).toBeInTheDocument();
    expect(screen.getByText("缺少话题")).toBeInTheDocument();
    expect(screen.getByText("微博可以不配图")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "小红书" }));

    expect(screen.getByText("标题来自正文摘要")).toBeInTheDocument();
    expect(screen.getByText("缺少话题")).toBeInTheDocument();
    expect(screen.getByText("建议补充配图提示")).toBeInTheDocument();
  });

  it("closes the publish assistant when editing starts or the draft changes", async () => {
    const { rerender } = render(
      <LiveDraft
        draft={{ title: "标题", body: "正文", hashtags: ["#话题"], imagePrompt: "画面" }}
        isBusy={false}
        isEditable
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.getByRole("dialog", { name: "发布助手" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.queryByRole("dialog", { name: "发布助手" })).not.toBeInTheDocument();

    rerender(
      <LiveDraft
        draft={{ title: "标题", body: "正文", hashtags: ["#话题"], imagePrompt: "画面" }}
        isBusy={false}
        isEditable
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    rerender(
      <LiveDraft
        draft={{ title: "新标题", body: "新正文", hashtags: ["#新话题"], imagePrompt: "新画面" }}
        isBusy={false}
        isEditable
        publishPackage={null}
      />
    );

    expect(screen.queryByRole("dialog", { name: "发布助手" })).not.toBeInTheDocument();
  });

  it("shows a clipboard error when publish copy fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <LiveDraft
        draft={{ title: "标题", body: "正文", hashtags: ["#话题"], imagePrompt: "画面" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    await userEvent.click(screen.getByRole("button", { name: "复制微博文案" }));

    expect(screen.getByRole("status")).toHaveTextContent("复制失败，请手动选中文案复制。");
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "shows platform-specific publish checks|closes the publish assistant|shows a clipboard error"
```

Expected: FAIL because checks and close behavior are not complete.

- [ ] **Step 3: Add check helpers**

Add this type and helper near the publish helper functions:

```tsx
type PublishCheck = {
  tone: "ok" | "warn" | "neutral";
  text: string;
};

function buildPublishChecks(draft: Draft, platform: PublishPlatform): PublishCheck[] {
  const title = resolveDraftTitle(draft.title, draft.body).trim();
  const hasExplicitTitle = Boolean(draft.title.trim());
  const hashtags = normalizedHashtags(draft.hashtags);
  const formattedText = formatPublishText(draft, platform);
  const hasImagePrompt = Boolean(draft.imagePrompt.trim());

  const shared: PublishCheck[] = [
    title
      ? { tone: hasExplicitTitle ? "ok" : "neutral", text: hasExplicitTitle ? "标题已生成" : "标题来自正文摘要" }
      : { tone: "warn", text: "缺少标题" },
    draft.body.trim() ? { tone: "ok", text: "正文已生成" } : { tone: "warn", text: "缺少正文" },
    hashtags.length ? { tone: "ok", text: "话题已整理为平台格式" } : { tone: "warn", text: "缺少话题" }
  ];

  if (platform === "weibo") {
    return [
      { tone: "neutral", text: `微博字数约 ${formattedText.length}` },
      ...shared,
      hasImagePrompt ? { tone: "neutral", text: "配图提示可选用" } : { tone: "neutral", text: "微博可以不配图" }
    ];
  }

  return [
    { tone: "neutral", text: `标题约 ${title.length} 字` },
    ...shared,
    hasImagePrompt ? { tone: "ok", text: "配图提示可用于封面" } : { tone: "warn", text: "建议补充配图提示" }
  ];
}
```

- [ ] **Step 4: Render checks in the dialog**

Inside the publish dialog, after the copy error block, add:

```tsx
          <div className="draft-publish-checks" aria-label={`${publishPlatformLabel(activePublishPlatform)}发布检查`}>
            {buildPublishChecks(content, activePublishPlatform).map((check) => (
              <p className={`draft-publish-check draft-publish-check--${check.tone}`} key={check.text}>
                <span aria-hidden="true">{check.tone === "ok" ? "✓" : check.tone === "warn" ? "!" : "•"}</span>
                <span>{check.text}</span>
              </p>
            ))}
          </div>
```

- [ ] **Step 5: Close the dialog on conflicting UI changes**

Update these existing functions/effects in `LiveDraft.tsx`:

```tsx
  useEffect(() => {
    setEditingMode(null);
    setDiffEditDraft(null);
    setSelectedDiffAction(null);
    setIsGeneratedDiffEditing(false);
    setIsPublishPanelOpen(false);
    setCopiedPublishAction(null);
    setPublishCopyError("");
    closeSelectionEdit();
    setShowDiff(false);
    setEditorFieldsFromDraft(baseEditableDraft);
  }, [baseEditableDraft?.title, baseEditableDraft?.body, baseEditableDraft?.imagePrompt, baseEditableDraft?.hashtags]);
```

```tsx
  function startEditing() {
    if (!content) return;

    setIsPublishPanelOpen(false);
    setEditorFieldsFromDraft(content);
    setEditingMode("normal");
  }
```

```tsx
  function toggleDiff() {
    setIsPublishPanelOpen(false);
    if (canDismissLiveDiff) {
      onDismissLiveDiff?.();
      return;
    }
    ...
  }
```

Also close the skills panel when opening publish from `TreeableApp` is not necessary because `LiveDraft` cannot control app-level skill state. Keep this for a later cross-component cleanup if the overlapping panels feel awkward in manual QA.

- [ ] **Step 6: Add check styles**

Append to `src/app/globals.css`:

```css
.draft-publish-checks {
  display: grid;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid #e2e8f0;
}

.draft-publish-check {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: #475569;
  font-size: 0.78rem;
  line-height: 1.35;
}

.draft-publish-check span:first-child {
  width: 14px;
  flex: 0 0 auto;
  font-weight: 900;
  text-align: center;
}

.draft-publish-check--ok span:first-child {
  color: #166534;
}

.draft-publish-check--warn span:first-child {
  color: #b45309;
}

.draft-publish-check--neutral span:first-child {
  color: #64748b;
}
```

- [ ] **Step 7: Run the checks and close tests**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "shows platform-specific publish checks|closes the publish assistant|shows a clipboard error"
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/components/draft/LiveDraft.tsx src/components/draft/LiveDraft.test.tsx src/app/globals.css
git commit -m "feat: add publish checks"
```

---

### Task 4: Regression Verification And Polish

**Files:**
- Modify if needed: `src/components/draft/LiveDraft.tsx`
- Modify if needed: `src/components/draft/LiveDraft.test.tsx`
- Modify if needed: `src/app/globals.css`

- [ ] **Step 1: Run the full LiveDraft test file**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx
```

Expected: PASS. If tests fail because multiple `role="status"` elements are present, scope the clipboard error assertion to `.draft-publish-panel`:

```tsx
const publishPanel = screen.getByRole("dialog", { name: "发布助手" });
expect(within(publishPanel).getByRole("status")).toHaveTextContent("复制失败，请手动选中文案复制。");
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Manual browser check**

Run the app:

```bash
npm run dev
```

Open the app in the browser and verify:

- A draft with title/body/hashtags shows `发布`.
- Clicking `发布` opens `发布助手`.
- `微博` tab defaults active.
- `小红书` tab switches preview and actions.
- `复制微博文案` and `复制小红书文案` show `已复制`.
- Long preview text scrolls inside the preview box without expanding the whole panel.
- The dialog does not overlap incoherently with the draft header on mobile width.

- [ ] **Step 5: Commit final polish if files changed**

If Step 1-4 required fixes, commit them:

```bash
git add src/components/draft/LiveDraft.tsx src/components/draft/LiveDraft.test.tsx src/app/globals.css
git commit -m "fix: polish publish assistant"
```

If no files changed, skip this commit.

---

## Self-Review

- Spec coverage: The plan covers the header `发布` entry, tabbed `发布助手`, platform previews, platform copy actions, hashtag normalization, copy success and failure states, publish checks, close behavior, styling, and verification.
- Placeholder scan: No placeholder markers or unresolved tasks remain.
- Type consistency: `PublishPlatform`, `PublishCopyAction`, and helper names are introduced before use and reused consistently across tasks.

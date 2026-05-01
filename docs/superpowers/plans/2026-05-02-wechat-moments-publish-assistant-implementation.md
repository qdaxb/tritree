# WeChat Moments Publish Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a body-first `朋友圈` tab to the existing `发布助手` so users can edit and copy Moments-ready text from the current draft body.

**Architecture:** Keep the feature inside `LiveDraft`, matching the existing publish assistant boundary. Extend the existing platform union, editable publish text state, formatter, copy action helpers, and readiness checks to support a third platform without adding API routes, persistence, or AI generation changes.

**Tech Stack:** Next.js client component, React state/effects, Vitest, Testing Library, existing clipboard helper.

---

## File Structure

- Modify `src/components/draft/LiveDraft.test.tsx`
  - Update the publish assistant tab test so it expects `朋友圈`.
  - Add a Moments copy test that proves the default text is body-only and user edits are copied.
  - Add a Moments checks test that proves checks react to edited text and image prompt state.
- Modify `src/components/draft/LiveDraft.tsx`
  - Extend `PublishPlatform`, `PublishCopyAction`, and `PublishTextByPlatform`.
  - Initialize and edit `publishTexts.moments`.
  - Render the `朋友圈` tab and `朋友圈文案` text area.
  - Add `moments` formatting, copy label, primary copy action, secondary action behavior, and checks.

No CSS change is required because the existing publish tab, preview text area, action, and check styles already support the added tab and body text area.

---

### Task 1: Add Failing Moments Coverage

**Files:**
- Modify: `src/components/draft/LiveDraft.test.tsx`

- [ ] **Step 1: Replace the existing platform tab test**

In `src/components/draft/LiveDraft.test.tsx`, replace the current test named `opens a publish assistant with Weibo and Xiaohongshu tabs` with this full test:

```tsx
  it("opens a publish assistant with Weibo, Xiaohongshu, and Moments tabs", async () => {
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
    expect(screen.getByRole("button", { name: "朋友圈" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("微博版预览")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "微博发布文案" })).toHaveValue(
      "先给对方一条主线，再补细节。\n\n#产品思考# #沟通效率#"
    );

    await userEvent.click(screen.getByRole("button", { name: "小红书" }));

    expect(screen.getByRole("button", { name: "微博" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "小红书" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "朋友圈" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("小红书版预览")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "小红书标题" })).toHaveValue("把复杂工作讲成一句人话");
    expect(screen.getByRole("textbox", { name: "小红书正文" })).toHaveValue("先给对方一条主线，再补细节。\n\n#产品思考 #沟通效率");

    await userEvent.click(screen.getByRole("button", { name: "朋友圈" }));

    expect(screen.getByRole("button", { name: "微博" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "小红书" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "朋友圈" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("朋友圈版预览")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "朋友圈文案" })).toHaveValue("先给对方一条主线，再补细节。");
  });
```

- [ ] **Step 2: Add the failing Moments copy test**

Append this test after `offers Xiaohongshu-specific copy actions`:

```tsx
  it("copies the edited body-first Moments text without title or topics", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <LiveDraft
        draft={{
          title: "不会进入朋友圈",
          body: "朋友圈正文第一句。\n朋友圈正文第二句。",
          hashtags: ["产品思考", "#沟通效率"],
          imagePrompt: "生活化手机随拍"
        }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    await userEvent.click(screen.getByRole("button", { name: "朋友圈" }));

    const momentsText = screen.getByRole("textbox", { name: "朋友圈文案" });
    expect(momentsText).toHaveValue("朋友圈正文第一句。\n朋友圈正文第二句。");
    expect((momentsText as HTMLTextAreaElement).value).not.toContain("不会进入朋友圈");
    expect((momentsText as HTMLTextAreaElement).value).not.toContain("#产品思考");
    expect(screen.queryByRole("button", { name: "复制标题" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制话题" })).not.toBeInTheDocument();

    fireEvent.change(momentsText, {
      target: { value: "手动改过的朋友圈文案" }
    });
    await userEvent.click(screen.getByRole("button", { name: "复制朋友圈文案" }));

    expect(writeText).toHaveBeenCalledWith("手动改过的朋友圈文案");
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  });
```

- [ ] **Step 3: Add the failing Moments checks test**

Append this test after `shows platform-specific publish checks without blocking copy`:

```tsx
  it("shows Moments publish checks from edited text and optional image prompt", async () => {
    render(
      <LiveDraft
        draft={{ title: "标题", body: "朋友圈长文".repeat(150), hashtags: ["#话题"], imagePrompt: "" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    await userEvent.click(screen.getByRole("button", { name: "朋友圈" }));

    expect(screen.getByText(/朋友圈字数约/)).toBeInTheDocument();
    expect(screen.getByText("正文已生成")).toBeInTheDocument();
    expect(screen.getByText("朋友圈长文可能需要收紧")).toBeInTheDocument();
    expect(screen.getByText("朋友圈可以不配图")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "朋友圈文案" }), {
      target: { value: "" }
    });

    expect(screen.getByText("朋友圈字数约 0")).toBeInTheDocument();
    expect(screen.getByText("缺少正文")).toBeInTheDocument();
  });
```

- [ ] **Step 4: Run the focused tests and verify they fail**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "Moments|publish assistant with Weibo"
```

Expected: FAIL. The output should include an error that Testing Library cannot find the `朋友圈` button or `朋友圈文案` textbox.

---

### Task 2: Implement the Moments Platform

**Files:**
- Modify: `src/components/draft/LiveDraft.tsx`
- Test: `src/components/draft/LiveDraft.test.tsx`

- [ ] **Step 1: Extend publish state and types**

In `src/components/draft/LiveDraft.tsx`, replace the current `publishTexts` state initializer:

```tsx
  const [publishTexts, setPublishTexts] = useState<PublishTextByPlatform>({
    weibo: "",
    xiaohongshu: "",
    moments: ""
  });
```

Near the bottom of the file, replace the publish type aliases with:

```tsx
type PublishPlatform = "weibo" | "xiaohongshu" | "moments";
type PublishCopyAction = "weibo" | "xiaohongshu" | "moments" | "title" | "body" | "hashtags" | "imagePrompt";
type PublishCheck = {
  text: string;
  tone: "ok" | "warn" | "neutral";
};
type PublishTextByPlatform = Record<PublishPlatform, string>;
```

- [ ] **Step 2: Initialize and copy the Moments editable text**

Replace `copyPublishText` with:

```tsx
  async function copyPublishText(action: PublishCopyAction) {
    if (!content) return;

    const value =
      action === "weibo"
        ? publishTexts.weibo.trim()
        : action === "xiaohongshu"
          ? publishTexts.xiaohongshu.trim()
          : action === "moments"
            ? publishTexts.moments.trim()
            : action === "title" && activePublishPlatform === "xiaohongshu"
              ? publishXiaohongshuTitle.trim()
              : action === "imagePrompt"
                ? publishImagePrompt.trim()
                : publishCopyValue(content, activePublishPlatform, action);
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

Replace `setPublishFieldsFromDraft` with:

```tsx
  function setPublishFieldsFromDraft(nextDraft: Draft | null) {
    setPublishTexts({
      weibo: nextDraft ? formatPublishText(nextDraft, "weibo") : "",
      xiaohongshu: nextDraft ? formatPublishText(nextDraft, "xiaohongshu") : "",
      moments: nextDraft ? formatPublishText(nextDraft, "moments") : ""
    });
    setPublishXiaohongshuTitle(nextDraft ? resolveDraftTitle(nextDraft.title, nextDraft.body).trim() : "");
    setPublishImagePrompt(nextDraft?.imagePrompt.trim() ?? "");
  }
```

- [ ] **Step 3: Render the Moments tab and text area**

In the publish platform group, replace the platform array with:

```tsx
            {(["weibo", "xiaohongshu", "moments"] as const).map((platform) => (
```

Replace the full `<section className="draft-publish-preview" ...>` block with:

```tsx
          <section className="draft-publish-preview" aria-label={`${publishPlatformLabel(activePublishPlatform)}版预览`}>
            {activePublishPlatform === "xiaohongshu" ? (
              <>
                <div className="draft-publish-preview__meta">
                  <span>小红书版预览</span>
                  <span>标题约 {publishXiaohongshuTitle.length} 字</span>
                </div>
                <textarea
                  aria-label="小红书标题"
                  className="draft-publish-preview__title-field"
                  onChange={(event) => {
                    setPublishXiaohongshuTitle(event.target.value);
                    setCopiedPublishAction(null);
                  }}
                  rows={2}
                  value={publishXiaohongshuTitle}
                />
                <div className="draft-publish-preview__meta">
                  <span>小红书正文</span>
                  <span>约 {publishTexts.xiaohongshu.length} 字</span>
                </div>
                <textarea
                  aria-label="小红书正文"
                  onChange={(event) => {
                    setPublishTexts((current) => ({
                      ...current,
                      xiaohongshu: event.target.value
                    }));
                    setCopiedPublishAction(null);
                  }}
                  rows={6}
                  value={publishTexts.xiaohongshu}
                />
              </>
            ) : activePublishPlatform === "moments" ? (
              <>
                <div className="draft-publish-preview__meta">
                  <span>朋友圈版预览</span>
                  <span>约 {publishTexts.moments.length} 字</span>
                </div>
                <textarea
                  aria-label="朋友圈文案"
                  onChange={(event) => {
                    setPublishTexts((current) => ({
                      ...current,
                      moments: event.target.value
                    }));
                    setCopiedPublishAction(null);
                  }}
                  rows={7}
                  value={publishTexts.moments}
                />
              </>
            ) : (
              <>
                <div className="draft-publish-preview__meta">
                  <span>微博版预览</span>
                  <span>约 {publishTexts.weibo.length} 字</span>
                </div>
                <textarea
                  aria-label="微博发布文案"
                  onChange={(event) => {
                    setPublishTexts((current) => ({
                      ...current,
                      weibo: event.target.value
                    }));
                    setCopiedPublishAction(null);
                  }}
                  rows={7}
                  value={publishTexts.weibo}
                />
              </>
            )}
          </section>
```

- [ ] **Step 4: Extend publish helper functions**

Replace `formatPublishText`, `publishPlatformLabel`, `publishPrimaryActionFor`, `publishCopyLabel`, `secondaryPublishActionsFor`, and `buildPublishChecks` with:

```tsx
function formatPublishText(draft: Draft, platform: PublishPlatform) {
  if (platform === "moments") return draft.body.trim();

  const body = draft.body.trim();
  const hashtags = normalizedHashtags(draft.hashtags, platform).join(" ");
  return [body, hashtags].filter(Boolean).join("\n\n");
}

function publishPlatformLabel(platform: PublishPlatform) {
  if (platform === "weibo") return "微博";
  if (platform === "xiaohongshu") return "小红书";
  return "朋友圈";
}

function publishCopyValue(draft: Draft, platform: PublishPlatform, action: PublishCopyAction) {
  if (action === "body") return draft.body.trim();
  if (action === "title") return resolveDraftTitle(draft.title, draft.body).trim();
  if (action === "hashtags") return normalizedHashtags(draft.hashtags, platform).join(" ");
  if (action === "imagePrompt") return draft.imagePrompt.trim();
  return formatPublishText(draft, platform);
}

function publishPrimaryActionFor(platform: PublishPlatform): PublishCopyAction {
  if (platform === "weibo") return "weibo";
  if (platform === "xiaohongshu") return "xiaohongshu";
  return "moments";
}

function publishCopyLabel(platform: PublishPlatform, action: PublishCopyAction) {
  void platform;
  if (action === "weibo") return "复制微博文案";
  if (action === "xiaohongshu") return "复制小红书文案";
  if (action === "moments") return "复制朋友圈文案";
  if (action === "title") return "复制标题";
  if (action === "body") return "复制正文";
  if (action === "imagePrompt") return "复制配图提示";
  return "复制话题";
}

function secondaryPublishActionsFor(draft: Draft, platform: PublishPlatform): PublishCopyAction[] {
  const actions: PublishCopyAction[] = [];
  if (platform === "moments") return actions;
  if (platform === "xiaohongshu" && resolveDraftTitle(draft.title, draft.body).trim()) actions.push("title");
  if (draft.body.trim()) actions.push("body");
  if (normalizedHashtags(draft.hashtags, platform).length) actions.push("hashtags");
  return actions;
}

function buildPublishChecks(
  draft: Draft,
  platform: PublishPlatform,
  publishText?: string,
  imagePrompt?: string,
  publishTitle?: string
): PublishCheck[] {
  const formattedText = publishText ?? formatPublishText(draft, platform);
  const hasImagePrompt = Boolean((imagePrompt ?? draft.imagePrompt).trim());

  if (platform === "moments") {
    const checks: PublishCheck[] = [
      { tone: "neutral", text: `朋友圈字数约 ${formattedText.length}` },
      formattedText.trim() ? { tone: "ok", text: "正文已生成" } : { tone: "warn", text: "缺少正文" }
    ];
    if (formattedText.length > 700) checks.push({ tone: "warn", text: "朋友圈长文可能需要收紧" });
    checks.push(hasImagePrompt ? { tone: "neutral", text: "配图提示可选用" } : { tone: "neutral", text: "朋友圈可以不配图" });
    return checks;
  }

  const resolvedTitle = resolveDraftTitle(draft.title, draft.body).trim();
  const title = (publishTitle ?? resolvedTitle).trim();
  const hasExplicitTitle = Boolean(draft.title.trim()) || (publishTitle !== undefined && title !== resolvedTitle);
  const hashtags = normalizedHashtags(draft.hashtags, platform);

  const shared: PublishCheck[] = [
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
    title
      ? { tone: hasExplicitTitle ? "ok" : "neutral", text: hasExplicitTitle ? "标题已生成" : "标题来自正文摘要" }
      : { tone: "warn", text: "缺少标题" },
    ...shared,
    hasImagePrompt ? { tone: "ok", text: "配图提示可用于封面" } : { tone: "warn", text: "建议补充配图提示" }
  ];
}
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx -t "Moments|publish assistant with Weibo"
```

Expected: PASS. The output should show the three focused tests passing.

- [ ] **Step 6: Commit the tested implementation**

Run:

```bash
git add src/components/draft/LiveDraft.tsx src/components/draft/LiveDraft.test.tsx
git commit -m "feat: add moments publish assistant"
```

Expected: Commit succeeds with changes to the LiveDraft component and tests.

---

### Task 3: Full Verification

**Files:**
- Verify: `src/components/draft/LiveDraft.tsx`
- Verify: `src/components/draft/LiveDraft.test.tsx`

- [ ] **Step 1: Run the full LiveDraft test file**

Run:

```bash
npm test -- src/components/draft/LiveDraft.test.tsx
```

Expected: PASS. This verifies existing Weibo, Xiaohongshu, image prompt, copy failure, closing behavior, editing, diff, and selection behavior still work.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. This verifies the extended `PublishPlatform`, `PublishCopyAction`, and `PublishTextByPlatform` types are internally consistent.

- [ ] **Step 3: Check the final diff**

Run:

```bash
git diff --stat HEAD~1..HEAD
git status --short
```

Expected: The diff stat shows only `src/components/draft/LiveDraft.tsx` and `src/components/draft/LiveDraft.test.tsx` in the implementation commit, and `git status --short` is empty.

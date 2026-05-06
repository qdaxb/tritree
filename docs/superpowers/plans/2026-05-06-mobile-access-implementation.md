# Mobile Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-only `树图` / `草稿` panel switcher and smart draft switching when generation starts.

**Architecture:** Keep `TreeCanvas` and `LiveDraft` unchanged. `TreeableApp` owns mobile viewport detection, active panel state, and generation-triggered switching; CSS owns responsive visibility and layout. Browser API access uses `matchMedia` inside `useEffect` with cleanup, matching current React and Next.js client component guidance from Context7.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS, Vitest, Testing Library.

---

## File Structure

- Modify `src/components/TreeableApp.tsx`
  - Add `MobilePanel` state.
  - Add mobile viewport detection with `window.matchMedia("(max-width: 980px)")`.
  - Add panel switcher markup.
  - Wrap existing `TreeCanvas` and `LiveDraft` in mobile panel containers.
  - Call a shared helper from direction-generation entry points.
- Modify `src/components/TreeableApp.test.tsx`
  - Add a reusable `matchMedia` viewport test helper.
  - Add focused tests for default mobile panel, desktop absence, smart switching, non-switching actions, and manual override.
- Modify `src/app/globals.css`
  - Add default panel wrapper rules that preserve desktop grid behavior.
  - Add responsive mobile switcher and active/inactive panel rules.
  - Tune mobile tree and draft panel heights.

No new component files are needed.

---

### Task 1: Mobile Panel Test Harness and Static Panel Tests

**Files:**
- Modify: `src/components/TreeableApp.test.tsx`

- [ ] **Step 1: Add viewport helpers to the test file**

Add this helper block after `controlledNdjsonResponse()` and before `describe("TreeableApp", ...)`:

```tsx
function installViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width
  });

  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const matches = query === "(max-width: 980px)" ? width <= 980 : false;
      const listeners = new Set<(event: MediaQueryListEvent) => void>();
      const mediaQueryList = {
        matches,
        media: query,
        onchange: null,
        addEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        addListener: (listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
        removeListener: (listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
        dispatchEvent: (event: Event) => {
          listeners.forEach((listener) => listener(event as MediaQueryListEvent));
          return true;
        }
      };

      return mediaQueryList as MediaQueryList;
    })
  );
}

function installMobileViewport() {
  installViewport(390);
}

function installDesktopViewport() {
  installViewport(1280);
}
```

- [ ] **Step 2: Run the existing TreeableApp test file**

Run: `npm test -- src/components/TreeableApp.test.tsx`

Expected: PASS. The helper is unused, so this confirms it does not disturb existing tests.

- [ ] **Step 3: Add failing tests for static mobile and desktop panel behavior**

Add these tests near the start of the `describe("TreeableApp", ...)` block, after `"opens the latest existing tree when a saved seed is loaded"`:

```tsx
  it("renders mobile panel controls with tree active by default", async () => {
    installMobileViewport();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByTestId("tree-canvas")).toBeInTheDocument();
    const switcher = screen.getByRole("group", { name: "移动端主面板" });
    expect(within(switcher).getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");
    expect(within(switcher).getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector(".mobile-panel--tree")).toHaveClass("mobile-panel--active");
    expect(document.querySelector(".mobile-panel--draft")).not.toHaveClass("mobile-panel--active");
  });

  it("does not render mobile panel controls on desktop", async () => {
    installDesktopViewport();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByTestId("tree-canvas")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "移动端主面板" })).not.toBeInTheDocument();
    expect(screen.getByTestId("live-draft")).toBeInTheDocument();
  });
```

- [ ] **Step 4: Run the focused tests and verify failure**

Run: `npm test -- src/components/TreeableApp.test.tsx -- -t "mobile panel controls|desktop"`

Expected: FAIL because `移动端主面板` and `.mobile-panel--tree` do not exist yet.

- [ ] **Step 5: Commit the failing tests**

```bash
git add src/components/TreeableApp.test.tsx
git commit -m "test: cover mobile panel shell"
```

---

### Task 2: Static Mobile Panel Shell

**Files:**
- Modify: `src/components/TreeableApp.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/TreeableApp.test.tsx`

- [ ] **Step 1: Add mobile panel types and viewport constant**

In `src/components/TreeableApp.tsx`, change the React import:

```tsx
import { useEffect, useRef, useState } from "react";
```

Add these declarations near the existing top-level type declarations:

```tsx
type MobilePanel = "tree" | "draft";

const MOBILE_LAYOUT_QUERY = "(max-width: 980px)";
```

- [ ] **Step 2: Add mobile layout state and matchMedia effect**

Inside `TreeableApp`, after the existing `useState` declarations, add:

```tsx
  const [activeMobilePanel, setActiveMobilePanel] = useState<MobilePanel>("tree");
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const mobileGenerationPanelOverrideRef = useRef(false);
```

After the existing initial `loadRoot` effect, add:

```tsx
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const syncMobileLayout = (event?: MediaQueryListEvent) => {
      setIsMobileLayout(event?.matches ?? mediaQuery.matches);
    };

    syncMobileLayout();
    mediaQuery.addEventListener("change", syncMobileLayout);

    return () => {
      mediaQuery.removeEventListener("change", syncMobileLayout);
    };
  }, []);
```

- [ ] **Step 3: Add mobile panel helpers**

Inside `TreeableApp`, before `loadRoot`, add:

```tsx
  function mobilePanelClassName(panel: MobilePanel) {
    return `mobile-panel mobile-panel--${panel}${activeMobilePanel === panel ? " mobile-panel--active" : ""}`;
  }

  function showMobilePanel(panel: MobilePanel) {
    if (isBusy || generationStage) {
      mobileGenerationPanelOverrideRef.current = true;
    }
    setActiveMobilePanel(panel);
  }
```

- [ ] **Step 4: Wrap the tree and draft surfaces**

In the ready-state JSX, insert the switcher immediately after the `</header>`:

```tsx
      {isMobileLayout ? (
        <div aria-label="移动端主面板" className="mobile-panel-switcher" role="group">
          <button
            aria-pressed={activeMobilePanel === "tree"}
            onClick={() => showMobilePanel("tree")}
            type="button"
          >
            树图
          </button>
          <button
            aria-pressed={activeMobilePanel === "draft"}
            onClick={() => showMobilePanel("draft")}
            type="button"
          >
            草稿
          </button>
        </div>
      ) : null}
```

Wrap the existing `canvas-region` section:

```tsx
      <div
        aria-hidden={isMobileLayout && activeMobilePanel !== "tree" ? "true" : undefined}
        className={mobilePanelClassName("tree")}
      >
        <section className="canvas-region">
          <TreeCanvas
            changedDraftNodeIds={changedDraftNodeIds}
            comparisonNodeIds={draftComparison}
            currentNode={currentNodeForCanvas}
            focusedNodeId={activeViewNodeId}
            generationStage={generationStage}
            isComparisonMode={Boolean(draftComparison)}
            isBusy={treeChoicesDisabled}
            onActivateBranch={activateHistoricalBranch}
            onAddCustomOption={activeViewNodeId ? addAndChooseCustomOption : undefined}
            onChoose={chooseFromViewedNode}
            onRegenerateOptions={canRegenerateOptions ? regenerateOptionsForCurrentNode : undefined}
            onSelectComparisonNode={selectDraftComparisonNode}
            onViewNode={(nodeId) => void viewNode(nodeId)}
            pendingBranch={pendingBranch}
            pendingChoice={pendingChoice}
            selectedPath={sessionState?.selectedPath ?? []}
            skills={enabledSkills}
            treeNodes={sessionState?.treeNodes}
          />
        </section>
      </div>
```

Wrap the existing `LiveDraft` component:

```tsx
      <div
        aria-hidden={isMobileLayout && activeMobilePanel !== "draft" ? "true" : undefined}
        className={mobilePanelClassName("draft")}
      >
        <LiveDraft
          canCompareDrafts={comparisonEntries.length >= 2}
          comparisonDrafts={comparisonDrafts}
          comparisonLabels={comparisonLabels}
          comparisonSelectionCount={comparisonSelectionCount}
          draft={viewedDraft}
          emptyStateActions={
            canRetryDraftGeneration ? (
              <button className="secondary-button" onClick={() => void retryDraftGeneration()} type="button">
                重试生成
              </button>
            ) : null
          }
          headerActions={
            <>
              <button
                aria-expanded={isSkillPanelOpen}
                className="draft-skill-button"
                disabled={isBusy || !sessionState}
                onClick={() => {
                  setIsSkillLibraryOpen(false);
                  setIsSkillPanelOpen((open) => !open);
                }}
                type="button"
              >
                {enabledSkillIds.length} 个技能
              </button>
            </>
          }
          headerPanel={
            isSkillPanelOpen && sessionState ? (
              <aside aria-label="本作品技能" className="draft-skill-panel">
                <header className="draft-skill-panel__header">
                  <div>
                    <p className="eyebrow">本作品技能</p>
                    <p className="draft-skill-panel__summary">已启用 {enabledSkillIds.length} 个</p>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={isBusy}
                    onClick={() => {
                      setIsSkillPanelOpen(false);
                      setIsSkillLibraryOpen(true);
                    }}
                    type="button"
                  >
                    管理技能库
                  </button>
                </header>
                <SkillPicker
                  disabled={isBusy}
                  onChange={(ids) => void saveSessionSkills(ids)}
                  selectedSkillIds={enabledSkillIds}
                  skills={skills}
                />
              </aside>
            ) : null
          }
          isBusy={isBusy}
          isComparisonMode={Boolean(draftComparison)}
          isEditable={Boolean(activeViewNodeId)}
          isLiveDiff={shouldShowGeneratedDiff}
          isLiveDiffStreaming={isLiveDraftStreaming}
          liveDiffStreamingField={liveDiffStreamingField}
          mode={isViewingCurrentNode ? "current" : "history"}
          onCancelComparison={cancelDraftComparison}
          onDismissLiveDiff={() => setGeneratedDiffNodeId(null)}
          onRewriteSelection={rewriteDraftSelection}
          onSave={saveDraft}
          onStartComparison={startDraftComparison}
          previousDraft={previousDraft}
          publishPackage={null}
        />
      </div>
```

- [ ] **Step 5: Add CSS for panel shell**

In `src/app/globals.css`, after `.topbar-actions`, add:

```css
.mobile-panel-switcher {
  display: none;
}

.mobile-panel {
  min-height: 0;
  display: contents;
}
```

Inside `@media (max-width: 980px)`, replace the `.app-shell` rule with:

```css
  .app-shell {
    min-height: 100dvh;
    height: auto;
    grid-template-columns: 1fr;
    grid-template-rows: auto auto minmax(0, 1fr);
    overflow: visible;
  }
```

Still inside `@media (max-width: 980px)`, add:

```css
  .mobile-panel-switcher {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    background: rgba(238, 242, 247, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 8px;
  }

  .mobile-panel-switcher button {
    min-height: 38px;
    color: #475569;
    background: transparent;
    border: 0;
    border-radius: 6px;
    font-weight: 850;
  }

  .mobile-panel-switcher button[aria-pressed="true"] {
    color: #0f766e;
    background: #ffffff;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
  }

  .mobile-panel {
    grid-column: 1 / -1;
    min-height: 0;
    display: none;
  }

  .mobile-panel--active {
    display: grid;
  }

  .mobile-panel--tree.mobile-panel--active {
    grid-template-rows: minmax(540px, auto);
  }

  .mobile-panel--draft.mobile-panel--active {
    grid-template-rows: minmax(0, 1fr);
  }

  .mobile-panel > .canvas-region,
  .mobile-panel > .draft-panel {
    min-height: 0;
  }
```

- [ ] **Step 6: Run focused tests**

Run: `npm test -- src/components/TreeableApp.test.tsx -- -t "mobile panel controls|desktop"`

Expected: PASS.

- [ ] **Step 7: Run full TreeableApp tests**

Run: `npm test -- src/components/TreeableApp.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit static shell**

```bash
git add src/components/TreeableApp.tsx src/app/globals.css src/components/TreeableApp.test.tsx
git commit -m "feat: add mobile panel shell"
```

---

### Task 3: Smart Draft Switching

**Files:**
- Modify: `src/components/TreeableApp.test.tsx`
- Modify: `src/components/TreeableApp.tsx`

- [ ] **Step 1: Add a focused mobile switching test for choosing a direction**

Add these tests near existing generation-flow tests:

```tsx
  it("switches to the draft panel when a mobile direction choice starts draft generation", async () => {
    installMobileViewport();
    const childNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      parentOptionId: "a" as const,
      roundIndex: 2,
      options: [],
      selectedOptionId: null
    };
    const chosenState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: childNode,
      currentDraft: activeState.currentDraft,
      nodeDrafts: [{ nodeId: "node-1", draft: activeState.currentDraft }],
      selectedPath: [activeState.currentNode, childNode]
    };
    const generatedState = {
      ...chosenState,
      currentDraft: { title: "Generated", body: "Generated body", hashtags: ["#AI"], imagePrompt: "Tree" },
      nodeDrafts: [
        { nodeId: "node-1", draft: activeState.currentDraft },
        { nodeId: "node-2", draft: { title: "Generated", body: "Generated body", hashtags: ["#AI"], imagePrompt: "Tree" } }
      ]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: chosenState }) })
      .mockResolvedValueOnce(optionsNdjsonResponse(generatedState))
      .mockResolvedValueOnce(optionsNdjsonResponse(generatedState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "choose displayed option" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(document.querySelector(".mobile-panel--draft")).toHaveClass("mobile-panel--active");
  });

  it("switches to the draft panel when a mobile historical branch starts generation", async () => {
    installMobileViewport();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "activate historical branch" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/branch",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "true");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/TreeableApp.test.tsx -- -t "switches to the draft panel"`

Expected: FAIL because direction choices leave `树图` active.

- [ ] **Step 3: Add the smart-switch helper**

In `TreeableApp`, below `showMobilePanel`, add:

```tsx
  function showMobileDraftForGeneration() {
    if (!isMobileLayout || mobileGenerationPanelOverrideRef.current) return;
    setActiveMobilePanel("draft");
  }
```

- [ ] **Step 4: Invoke the helper from generation entry points**

In `choose`, after the guard clauses and before `setPendingChoice(optionId)`, add:

```tsx
    showMobileDraftForGeneration();
```

In `activateHistoricalBranch`, after the guard clauses and before `setPendingBranch({ nodeId, optionId })`, add:

```tsx
    showMobileDraftForGeneration();
```

In `retryDraftGeneration`, after the guard clause and before `setGeneratedDiffNodeId(null)`, add:

```tsx
    showMobileDraftForGeneration();
```

- [ ] **Step 5: Extend the existing retry test for mobile switching**

In `"shows a retry action after draft generation fails for a draftless current node"`, add `installMobileViewport();` as the first statement in the test. After this line:

```tsx
    const retryActionArea = screen.getByTestId("mock-draft-empty-actions");
```

add:

```tsx
    await userEvent.click(screen.getByRole("button", { name: "树图" }));
    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");
```

After clicking the retry button:

```tsx
    await userEvent.click(within(retryActionArea).getByRole("button", { name: "重试生成" }));
```

add:

```tsx
    expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "true");
```

- [ ] **Step 6: Run focused test**

Run: `npm test -- src/components/TreeableApp.test.tsx -- -t "switches to the draft panel"`

Expected: PASS.

- [ ] **Step 7: Run retry switching test**

Run: `npm test -- src/components/TreeableApp.test.tsx -- -t "retry action"`

Expected: PASS.

- [ ] **Step 8: Commit smart-switch behavior**

```bash
git add src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx
git commit -m "feat: switch mobile panel during draft generation"
```

---

### Task 4: Non-Switching Actions and Manual Override

**Files:**
- Modify: `src/components/TreeableApp.test.tsx`
- Modify: `src/components/TreeableApp.tsx`

- [ ] **Step 1: Add tests for actions that stay on tree**

Add these tests after the smart-switch test:

```tsx
  it("keeps the tree panel active when mobile options are regenerated", async () => {
    installMobileViewport();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce(optionsNdjsonResponse(activeState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "regenerate focused options" }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/sessions/session-1/options",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the tree panel active when viewing a historical node without generation", async () => {
    installMobileViewport();
    const historicalNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      roundIndex: 2
    };
    const state = {
      ...activeState,
      treeNodes: [activeState.currentNode, historicalNode],
      nodeDrafts: [
        { nodeId: "node-1", draft: activeState.currentDraft },
        { nodeId: "node-2", draft: { title: "History", body: "History body", hashtags: [], imagePrompt: "" } }
      ]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "view historical node" }));

    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
```

- [ ] **Step 2: Add a test for manual override during generation**

Add this test after the non-switching tests:

```tsx
  it("respects a manual mobile tree switch during active generation", async () => {
    installMobileViewport();
    const draftStream = controlledNdjsonResponse();
    const childNode = {
      ...activeState.currentNode,
      id: "node-2",
      parentId: "node-1",
      parentOptionId: "a" as const,
      roundIndex: 2,
      options: [],
      selectedOptionId: null
    };
    const chosenState = {
      ...activeState,
      session: { ...activeState.session, currentNodeId: "node-2" },
      currentNode: childNode,
      nodeDrafts: [{ nodeId: "node-1", draft: activeState.currentDraft }],
      selectedPath: [activeState.currentNode, childNode]
    };
    const generatedState = {
      ...chosenState,
      currentDraft: { title: "Generated", body: "Generated body", hashtags: ["#AI"], imagePrompt: "Tree" },
      nodeDrafts: [
        { nodeId: "node-1", draft: activeState.currentDraft },
        { nodeId: "node-2", draft: { title: "Generated", body: "Generated body", hashtags: ["#AI"], imagePrompt: "Tree" } }
      ]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: activeState }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: chosenState }) })
      .mockResolvedValueOnce(draftStream.response)
      .mockResolvedValueOnce(optionsNdjsonResponse(generatedState));
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    expect(await screen.findByRole("group", { name: "移动端主面板" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "choose displayed option" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "草稿" })).toHaveAttribute("aria-pressed", "true");
    });

    await userEvent.click(screen.getByRole("button", { name: "树图" }));
    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      draftStream.push({ type: "draft", draft: generatedState.currentDraft, streamingField: "body" });
      draftStream.push({ type: "done", state: generatedState });
      draftStream.close();
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        6,
        "/api/sessions/session-1/options",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(screen.getByRole("button", { name: "树图" })).toHaveAttribute("aria-pressed", "true");
  });
```

- [ ] **Step 3: Clear manual override after generation completes**

Add this effect after the mobile viewport effect:

```tsx
  useEffect(() => {
    if (!isBusy && !generationStage) {
      mobileGenerationPanelOverrideRef.current = false;
    }
  }, [generationStage, isBusy]);
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/components/TreeableApp.test.tsx -- -t "keeps the tree panel|manual mobile tree switch|switches to the draft panel"`

Expected: PASS.

- [ ] **Step 5: Commit behavior coverage**

```bash
git add src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx
git commit -m "test: cover mobile panel switching rules"
```

---

### Task 5: Mobile CSS Contracts and Full Verification

**Files:**
- Modify: `src/components/TreeableApp.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add a CSS contract test**

Add this test near other CSS contract tests in `TreeableApp.test.tsx`:

```tsx
  it("defines mobile-only panel visibility rules", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const defaultPanelRule = css.match(/\.mobile-panel\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const mediaRule = css.match(/@media \(max-width: 980px\)\s*\{(?<body>[\s\S]+?)@media \(max-width: 640px\)/)?.groups?.body ?? "";

    expect(defaultPanelRule).toContain("display: contents");
    expect(mediaRule).toContain(".mobile-panel-switcher");
    expect(mediaRule).toContain("display: none");
    expect(mediaRule).toContain(".mobile-panel--active");
    expect(mediaRule).toContain("display: grid");
    expect(mediaRule).toContain("grid-template-rows: auto auto minmax(0, 1fr)");
  });
```

If `readFileSync` and `join` are not imported in `TreeableApp.test.tsx`, add:

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

- [ ] **Step 2: Run CSS contract test**

Run: `npm test -- src/components/TreeableApp.test.tsx -- -t "mobile-only panel visibility"`

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Build the app**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Start local dev server for visual verification**

Run: `npm run dev`

Expected: Next.js dev server starts and prints a local URL, usually `http://localhost:3000`.

- [ ] **Step 7: Verify in the in-app browser**

Open the dev server URL in the in-app browser. Check these viewports:

```text
Desktop: 1280px wide
Expected: no mobile panel switcher; tree and draft are both visible in the current workbench.

Mobile: 390px wide
Expected: `树图` / `草稿` switcher is visible; `树图` is active by default; only one main panel takes space.
```

Then trigger a direction choice on mobile:

```text
Expected: the active switcher button changes to `草稿`; streaming or generated draft feedback is visible.
```

Trigger `换一组方向` on mobile:

```text
Expected: the active switcher button remains `树图`.
```

- [ ] **Step 8: Commit final verification adjustments**

If Step 7 required CSS or test adjustments, commit them:

```bash
git add src/app/globals.css src/components/TreeableApp.test.tsx src/components/TreeableApp.tsx
git commit -m "fix: polish mobile panel layout"
```

If Step 7 required no changes, do not create an empty commit.

---

## Final Verification

Run these commands before reporting completion:

```bash
npm test
npm run typecheck
npm run build
```

All three commands must pass. Also leave the dev server running and share the local URL so the user can try the mobile flow.

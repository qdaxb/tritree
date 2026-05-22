# Left Artifact Right Control Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop always use a left artifact / right control layout where one right-header toggle expands the control column and switches the tree from compact to detail mode.

**Architecture:** Keep state ownership in `TreeableApp` and pass a tree label mode down into `TreeCanvas`. `TreeCanvas` owns only the visual label density; branch behavior and history behavior remain unchanged. The custom direction composer keeps the current option creation path but renders as a compact input plus send button in the persistent right-control slot.

**Tech Stack:** Next.js 16, React 19, TypeScript, D3, lucide-react, Vitest, Testing Library.

---

## File Structure

- Modify `src/components/TreeableApp.tsx`
  - Replace desktop `isArtifactPanelExpanded` / `isDesktopFocusTreeExpanded` behavior with `isControlPanelExpanded`.
  - Render desktop order as artifact first, right control second.
  - Keep mobile layout behavior unchanged.
  - Put the desktop toggle in the right control header.
  - Pass `treeLabelMode="compact"` or `"detail"` into `TreeCanvas`.

- Modify `src/components/tree/TreeCanvas.tsx`
  - Add `treeLabelMode?: "compact" | "detail"` prop, defaulting to `"detail"` so existing direct uses keep current labels.
  - Hide SVG `.force-labels` only when the mode is compact.
  - Keep SVG `title` elements and all node click handlers unchanged.
  - Add a compact persistent custom direction composer path for `isCustomOptionInline`.

- Modify `src/app/globals.css`
  - Change desktop app-shell columns to default left artifact / right control.
  - Add `app-shell--control-expanded` right-control-focused columns.
  - Add right control header/body styles.
  - Add compact inline custom direction styles.
  - Keep mobile media query behavior unchanged.

- Modify `src/components/TreeableApp.test.tsx`
  - Update `TreeCanvas` mock to accept and expose `treeLabelMode`.
  - Replace desktop artifact expansion expectations with permanent left artifact / right control expectations.
  - Add CSS expectations for default and expanded column weights.

- Modify `src/components/tree/TreeCanvas.test.tsx`
  - Add compact/detail tree label tests.
  - Update inline custom direction tests to expect an input plus send button and no visible header/label/close.
  - Add CSS expectations for compact inline direction controls.

---

### Task 1: Add Tree Label Mode In `TreeCanvas`

**Files:**
- Modify: `src/components/tree/TreeCanvas.tsx`
- Test: `src/components/tree/TreeCanvas.test.tsx`

- [ ] **Step 1: Write failing tests for compact and detail tree labels**

Add these tests inside `describe("TreeCanvas", () => { ... })`, near the existing seed-root label test.

```tsx
  it("keeps node titles but hides visual labels in compact tree mode", () => {
    const { container } = render(
      <TreeCanvas
        currentNode={selectedNode}
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[currentNode, selectedNode]}
        treeLabelMode="compact"
      />
    );

    const seedElement = container.querySelector(".tree-node--seed-root");

    expect(seedElement?.querySelector("title")).toHaveTextContent("种子念头");
    expect(container.querySelectorAll(".force-labels")).toHaveLength(0);
  });

  it("shows visual node labels in detail tree mode", () => {
    const { container } = render(
      <TreeCanvas
        currentNode={selectedNode}
        isBusy={false}
        onChoose={vi.fn()}
        pendingChoice={null}
        selectedPath={[currentNode, selectedNode]}
        treeLabelMode="detail"
      />
    );

    const seedElement = container.querySelector(".tree-node--seed-root");

    expect(seedElement?.querySelector("title")).toHaveTextContent("种子念头");
    expect(seedElement?.querySelector(".force-labels")).toHaveTextContent("种子念头");
  });
```

- [ ] **Step 2: Run the focused TreeCanvas tests and verify failure**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected:

- The test run fails at TypeScript or runtime level because `treeLabelMode` is not a `TreeCanvas` prop yet.

- [ ] **Step 3: Add the tree label mode prop**

In `src/components/tree/TreeCanvas.tsx`, update the prop type.

```tsx
type TreeLabelMode = "compact" | "detail";

type TreeCanvasProps = {
  changedArtifactNodeIds?: string[];
  comparisonNodeIds?: ComparisonNodeIds | null;
  currentNode: TreeNode | null;
  display?: "full" | "options" | "tree";
  generationStage?: NodeGenerationStage | null;
  isBusy: boolean;
  isComparisonMode?: boolean;
  isMobileLayout?: boolean;
  onActivateBranch?: (nodeId: string, optionId: BranchOption["id"]) => void;
  onAddCustomOption?: (option: BranchOption) => void;
  onChoose: (optionId: BranchOption["id"], note?: string, optionMode?: OptionGenerationMode) => void;
  onRegenerateOptions?: (optionMode: OptionGenerationMode) => void;
  onSelectComparisonNode?: (nodeId: string) => void;
  onViewNode?: (nodeId: string) => void;
  optionsHeaderAction?: ReactNode;
  pendingBranch?: { nodeId: string; optionId: BranchOption["id"] } | null;
  pendingChoice: BranchOption["id"] | null;
  selectedPath: TreeNode[];
  skills?: Skill[];
  treeLabelMode?: TreeLabelMode;
  treeNodes?: TreeNode[];
};
```

In the `TreeCanvas` parameter destructuring, default it to detail:

```tsx
  treeLabelMode = "detail",
```

- [ ] **Step 4: Hide SVG labels only in compact mode**

Replace the `.force-labels` data binding in the D3 effect.

```tsx
    node
      .selectAll<SVGTextElement, ForceTreeNode>("text.force-labels")
      .data((datum) => (treeLabelMode === "detail" && datum.kind !== "loading" ? [datum] : []))
      .join(
        (enter) => enter.append("text").attr("class", "force-labels"),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("dy", 24)
      .attr("text-anchor", "middle")
      .text((datum) => datum.label);
```

Add `treeLabelMode` to the D3 `useEffect` dependency list.

```tsx
    treeLabelMode
```

- [ ] **Step 5: Add a CSS state hook for compact mode**

In the `className={clsx(...)}` for the root `.tree-canvas`, add:

```tsx
        treeLabelMode === "compact" && "tree-canvas--compact"
```

This class is only a styling hook; click behavior remains unchanged.

- [ ] **Step 6: Run the focused TreeCanvas tests and verify pass**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected:

- `TreeCanvas.test.tsx` passes.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/components/tree/TreeCanvas.tsx src/components/tree/TreeCanvas.test.tsx
git commit -m "feat: add compact tree label mode"
```

---

### Task 2: Make Desktop Layout Permanent Left Artifact / Right Control

**Files:**
- Modify: `src/components/TreeableApp.tsx`
- Test: `src/components/TreeableApp.test.tsx`

- [ ] **Step 1: Update the TreeCanvas mock to expose tree label mode**

In `src/components/TreeableApp.test.tsx`, update the mocked `TreeCanvas` parameter list and type.

```tsx
    treeLabelMode,
```

Add the type field:

```tsx
    treeLabelMode?: "compact" | "detail";
```

Include it in the `treeCanvasMock(...)` payload.

```tsx
      treeLabelMode
```

Render it in the mock output:

```tsx
        <div data-testid="canvas-tree-label-mode">{treeLabelMode ?? "detail"}</div>
```

- [ ] **Step 2: Replace the desktop layout interaction test**

Replace the existing `it("expands and restores the desktop artifact workspace", async () => { ... })` test with:

```tsx
  it("uses a permanent left artifact and right control desktop layout", async () => {
    installDesktopViewport();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: finishedState }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<TreeableApp />);

    await screen.findByTestId("live-artifact");
    const shell = screen.getByRole("main");
    const artifactPanel = document.querySelector(".mobile-panel--artifact");
    const controlPanel = screen.getByRole("region", { name: "桌面控制区" });
    const shellChildren = Array.from(shell.children);

    expect(shell).toHaveClass("app-shell--artifact-focused");
    expect(shell).not.toHaveClass("app-shell--control-expanded");
    expect(artifactPanel).not.toBeNull();
    expect(shellChildren.indexOf(artifactPanel as Element)).toBeLessThan(shellChildren.indexOf(controlPanel));
    expect(screen.getByRole("button", { name: "展开控制区" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByTestId("canvas-display").map((item) => item.textContent)).toEqual(["tree", "options"]);
    expect(screen.getAllByTestId("canvas-tree-label-mode").map((item) => item.textContent)).toEqual(["compact", "compact"]);

    await userEvent.click(screen.getByRole("button", { name: "展开控制区" }));

    expect(shell).toHaveClass("app-shell--control-expanded");
    expect(screen.getByRole("button", { name: "收起控制区" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("canvas-display").map((item) => item.textContent)).toEqual(["tree", "options"]);
    expect(screen.getAllByTestId("canvas-tree-label-mode").map((item) => item.textContent)).toEqual(["detail", "detail"]);

    await userEvent.click(screen.getByRole("button", { name: "收起控制区" }));

    expect(shell).toHaveClass("app-shell--artifact-focused");
    expect(shell).not.toHaveClass("app-shell--control-expanded");
    expect(screen.getByRole("button", { name: "展开控制区" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByTestId("canvas-tree-label-mode").map((item) => item.textContent)).toEqual(["compact", "compact"]);
  });
```

- [ ] **Step 3: Run the focused TreeableApp test and verify failure**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected:

- The new desktop layout test fails because the current DOM still renders desktop tree/control before artifact and uses the old artifact expansion toggle.

- [ ] **Step 4: Replace desktop layout state**

In `src/components/TreeableApp.tsx`, replace:

```tsx
  const [isArtifactPanelExpanded, setIsArtifactPanelExpanded] = useState(false);
  const [isDesktopFocusTreeExpanded, setIsDesktopFocusTreeExpanded] = useState(false);
```

with:

```tsx
  const [isControlPanelExpanded, setIsControlPanelExpanded] = useState(false);
```

Keep `isMobileTreeExpanded` unchanged.

- [ ] **Step 5: Update mobile reset effects**

Replace the old mobile reset effects that reference `isArtifactPanelExpanded` and `isDesktopFocusTreeExpanded` with:

```tsx
  useEffect(() => {
    if (!isMobileLayout) {
      setIsMobileTreeExpanded(false);
      setIsAccountMenuOpen(false);
    } else {
      setIsControlPanelExpanded(false);
    }
  }, [isMobileLayout]);
```

Remove the effect that clears `isDesktopFocusTreeExpanded`.

- [ ] **Step 6: Add right control toggle rendering**

Replace `renderDesktopTreeToggle` with:

```tsx
  function renderDesktopControlToggle() {
    return (
      <button
        aria-expanded={isControlPanelExpanded}
        className="desktop-control-toggle"
        onClick={() => setIsControlPanelExpanded((expanded) => !expanded)}
        type="button"
      >
        {isControlPanelExpanded ? (
          <Minimize2 aria-hidden="true" size={14} strokeWidth={2.35} />
        ) : (
          <Maximize2 aria-hidden="true" size={14} strokeWidth={2.35} />
        )}
        <span>{isControlPanelExpanded ? "收起控制区" : "展开控制区"}</span>
      </button>
    );
  }
```

Remove `renderDesktopFocusCanvas`.

- [ ] **Step 7: Pass tree label mode into TreeCanvas**

Update `renderTreeCanvas` to compute and pass the label mode:

```tsx
  function renderTreeCanvas(display: "full" | "options" | "tree", optionsHeaderAction?: ReactNode) {
    const treeLabelMode = !isMobileLayout && (display === "tree" || display === "options")
      ? isControlPanelExpanded
        ? "detail" as const
        : "compact" as const
      : "detail" as const;

    return (
      <TreeCanvas
        changedArtifactNodeIds={changedArtifactNodeIds}
        comparisonNodeIds={artifactComparison}
        currentNode={currentNodeForCanvas}
        display={display}
        generationStage={treeGenerationStage}
        isComparisonMode={Boolean(artifactComparison)}
        isBusy={treeChoicesDisabled}
        isMobileLayout={isMobileLayout}
        onActivateBranch={activateHistoricalBranch}
        onAddCustomOption={activeViewNodeId ? addAndChooseCustomOption : undefined}
        onChoose={chooseFromViewedNode}
        onRegenerateOptions={canRefreshOptions ? regenerateOptionsForCurrentNode : undefined}
        onSelectComparisonNode={selectArtifactComparisonNode}
        onViewNode={(nodeId) => void viewNode(nodeId)}
        optionsHeaderAction={optionsHeaderAction}
        pendingBranch={pendingBranch}
        pendingChoice={pendingChoice}
        selectedPath={sessionState?.selectedPath ?? []}
        skills={enabledSkills}
        treeLabelMode={treeLabelMode}
        treeNodes={sessionState?.treeNodes}
      />
    );
  }
```

- [ ] **Step 8: Extract reusable artifact workspace node**

Before the `return`, create:

```tsx
  const artifactWorkspaceNode = (
    <div className={mobilePanelClassName("artifact", isMobileLayout ? "mobile-panel--unified" : undefined)}>
      <div
        aria-busy={isMobileArtifactModuleGenerating}
        className={mobileArtifactRegionClassName}
        ref={mobileArtifactRegionRef}
      >
        <ArtifactWorkspace
          artifacts={fullDisplayArtifacts}
          canCompareArtifacts={comparisonEntries.length >= 2}
          comparisonArtifacts={comparisonArtifacts}
          comparisonLabels={comparisonLabels}
          comparisonSelectionCount={comparisonSelectionCount}
          currentNode={currentNodeForCanvas}
          generationStage={artifactGenerationStage}
          publishPlatforms={selectedArtifactPublishPlatforms}
          headerActions={
            <button
              aria-expanded={isSkillPanelOpen}
              className="secondary-button"
              disabled={isBusy || !sessionState}
              onClick={() => {
                setIsSkillLibraryOpen(false);
                setIsSkillPanelOpen((open) => !open);
              }}
              type="button"
            >
              {enabledSkillIds.length} 个技能
            </button>
          }
          headerPanel={
            isSkillPanelOpen && sessionState ? (
              <aside aria-label="本作品技能" className="work-skill-panel">
                <header className="work-skill-panel__header">
                  <div>
                    <p className="eyebrow">本作品技能</p>
                    <p className="work-skill-panel__summary">已启用 {enabledSkillIds.length} 个</p>
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
          isComparisonMode={Boolean(artifactComparison)}
          isGenerating={Boolean(artifactGenerationStage)}
          onAction={handleArtifactAction}
          onCancelComparison={cancelArtifactComparison}
          onSave={saveArtifact}
          onStartComparison={startArtifactComparison}
          onStopGeneration={isBusy && generationStage ? stopActiveGeneration : undefined}
          selectedArtifactId={effectiveSelectedArtifactId}
          streamingProcessMaterials={activeProcessMaterials}
          thinkingText={activeThinking?.text}
        />
      </div>
      {isMobileLayout ? (
        <section
          aria-busy={isMobileOptionsModuleGenerating}
          aria-label="当前问题和选项"
          className={mobileOptionsRegionClassName}
        >
          {renderTreeCanvas("options")}
        </section>
      ) : null}
    </div>
  );
```

This is the same `ArtifactWorkspace` content as today, except the old artifact layout toggle button is removed from `headerActions`.

- [ ] **Step 9: Add desktop right control node**

Before the `return`, create:

```tsx
  const desktopControlNode = !isMobileLayout ? (
    <div
      aria-label="桌面控制区"
      className={mobilePanelClassName("tree", "mobile-panel--desktop-control")}
      role="region"
    >
      <section className="desktop-control-region">
        <header className="desktop-control-region__header">
          <strong>树图 / 方向</strong>
          {renderDesktopControlToggle()}
        </header>
        <div className="desktop-control-region__body">
          <div className="desktop-control-region__tree">{renderTreeCanvas("tree")}</div>
          <div className="desktop-control-region__options">{renderTreeCanvas("options")}</div>
        </div>
      </section>
    </div>
  ) : null;
```

- [ ] **Step 10: Reorder desktop render output**

Change the `main` class name:

```tsx
    <main
      className={`app-shell app-shell--artifact-focused${
        isControlPanelExpanded && !isMobileLayout ? " app-shell--control-expanded" : ""
      }`}
    >
```

In the JSX after `SkillLibraryPanel`, use this order:

```tsx
      {isMobileLayout ? (
        <div aria-label="移动端树图控制" className="mobile-tree-toggle" role="group">
          ...
        </div>
      ) : null}
      {isMobileLayout && isMobileTreeExpanded ? (
        <div
          aria-label="移动端树图"
          className={mobilePanelClassName("tree", "mobile-panel--expanded")}
          role="region"
        >
          <section className="canvas-region">
            {renderTreeCanvas("tree")}
          </section>
        </div>
      ) : null}
      {artifactWorkspaceNode}
      {desktopControlNode}
```

Remove the old desktop branch that rendered `.canvas-region` before the artifact panel.

- [ ] **Step 11: Run focused TreeableApp tests and verify pass**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected:

- `TreeableApp.test.tsx` passes.

- [ ] **Step 12: Commit Task 2**

```bash
git add src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx
git commit -m "feat: make desktop layout left artifact right control"
```

---

### Task 3: Simplify Persistent Custom Direction Composer

**Files:**
- Modify: `src/components/tree/TreeCanvas.tsx`
- Test: `src/components/tree/TreeCanvas.test.tsx`

- [ ] **Step 1: Update the inline custom direction test**

Replace the first test body for `keeps a custom direction composer open at the bottom in vertical option mode` with:

```tsx
  it("keeps a compact custom direction input at the bottom in vertical option mode", () => {
    const onAddCustomOption = vi.fn();
    render(
      <BranchOptionTray
        isBusy={false}
        isCustomOptionInline
        onAddCustomOption={onAddCustomOption}
        onChoose={vi.fn()}
        options={currentNode.options}
        pendingChoice={null}
        question="这次最需要先确认什么？"
      />
    );

    const tray = screen.getByRole("group", { name: "回答当前问题" });
    const customInput = within(tray).getByRole("textbox", { name: "自己写方向" });
    const sendButton = within(tray).getByRole("button", { name: "发送" });

    expect(within(tray).queryByRole("button", { name: "自己写方向" })).not.toBeInTheDocument();
    expect(within(tray).queryByRole("button", { name: "关闭自己写方向" })).not.toBeInTheDocument();
    expect(within(tray).queryByText("自己写方向")).not.toBeInTheDocument();
    expect(customInput.tagName).toBe("INPUT");
    expect(sendButton).toBeDisabled();

    fireEvent.change(customInput, { target: { value: "从评论区提问开头" } });
    expect(sendButton).toBeEnabled();
    fireEvent.click(sendButton);

    expect(onAddCustomOption).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "从评论区提问开头",
        impact: "按用户自定义方向继续生成。",
        kind: "reframe",
        label: "从评论区提问开头"
      })
    );
    expect(within(tray).getByRole("textbox", { name: "自己写方向" })).toHaveValue("");
  });
```

- [ ] **Step 2: Add CSS expectations for compact custom input**

Add this CSS test near the existing branch-side-form CSS test:

```tsx
  it("renders the inline custom direction as a compact input row", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const compactRule = css.match(/\.branch-side-form--compact\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const compactHeaderRule =
      css.match(/\.branch-side-form--compact \.branch-side-form__header\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const compactFieldLabelRule =
      css.match(/\.branch-side-form--compact \.branch-card__field > span\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const compactInputRule =
      css.match(/\.branch-side-form--compact \.branch-card__field input\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(compactRule).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(compactRule).toContain("padding: 0");
    expect(compactHeaderRule).toContain("display: none");
    expect(compactFieldLabelRule).toContain("display: none");
    expect(compactInputRule).toContain("min-height: 38px");
  });
```

- [ ] **Step 3: Run focused TreeCanvas tests and verify failure**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected:

- The updated custom input test fails because the current inline composer renders a visible header, a label, and a `textarea`.

- [ ] **Step 4: Add compact inline props to MoreDirectionsCard**

In `MoreDirectionsCard` props, add:

```tsx
  isCompactInline?: boolean;
```

In the function parameters, default it:

```tsx
  isCompactInline = false,
```

- [ ] **Step 5: Render input instead of textarea for compact inline mode**

Replace the label/textarea area in `MoreDirectionsCard` with this conditional:

```tsx
      <label className="branch-card__field">
        <span>{fieldLabel}</span>
        {isCompactInline ? (
          <input
            aria-label={textareaLabel}
            disabled={disabled}
            onChange={(event) => setContent(event.target.value)}
            placeholder={placeholder}
            type="text"
            value={content}
          />
        ) : (
          <textarea
            aria-label={textareaLabel}
            disabled={disabled}
            onChange={(event) => setContent(event.target.value)}
            placeholder={placeholder}
            rows={3}
            value={content}
          />
        )}
      </label>
```

Keep the existing submit button text as `{submitLabel}`.

- [ ] **Step 6: Pass compact inline mode from the persistent composer**

In the `BranchOptionTray` persistent `MoreDirectionsCard`, change:

```tsx
            formClassName="branch-side-form branch-side-form--inline"
```

to:

```tsx
            formClassName="branch-side-form branch-side-form--inline branch-side-form--compact"
            isCompactInline
```

- [ ] **Step 7: Add compact inline CSS**

In `src/app/globals.css`, after the existing `.branch-side-form--inline` block, add:

```css
.branch-side-form--compact {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
}

.branch-side-form--compact .branch-side-form__header,
.branch-side-form--compact .branch-card__field > span {
  display: none;
}

.branch-side-form--compact .branch-card__field {
  grid-column: 1;
}

.branch-side-form--compact .branch-card__field input {
  min-height: 38px;
  width: 100%;
  padding: 8px 10px;
  color: var(--ink);
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.36);
  border-radius: 8px;
  outline: none;
}

.branch-side-form--compact .branch-card__field input:focus {
  border-color: rgba(15, 118, 110, 0.44);
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12);
}

.branch-side-form--compact .branch-card__confirm {
  grid-column: 2;
  min-width: 52px;
  min-height: 38px;
  margin-top: 0;
}
```

- [ ] **Step 8: Run focused TreeCanvas tests and verify pass**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected:

- `TreeCanvas.test.tsx` passes.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/components/tree/TreeCanvas.tsx src/components/tree/TreeCanvas.test.tsx src/app/globals.css
git commit -m "feat: simplify custom direction composer"
```

---

### Task 4: Update Desktop Layout CSS

**Files:**
- Modify: `src/app/globals.css`
- Test: `src/components/TreeableApp.test.tsx`

- [ ] **Step 1: Replace expanded desktop CSS expectations**

Replace the `it("defines a wider desktop grid for the expanded artifact workspace", () => { ... })` test with:

```tsx
  it("defines desktop columns for artifact focus and control focus", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const shellRule = css.match(/\.app-shell\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const controlExpandedRule =
      css.match(/\.app-shell--control-expanded\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const controlRegionRule =
      css.match(/\.desktop-control-region\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const controlHeaderRule =
      css.match(/\.desktop-control-region__header\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const controlBodyRule =
      css.match(/\.desktop-control-region__body\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const expandedControlBodyRule =
      css.match(/\.app-shell--control-expanded \.desktop-control-region__body\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(shellRule).toContain("grid-template-columns: minmax(520px, 1.42fr) minmax(320px, 0.58fr)");
    expect(controlExpandedRule).toContain("grid-template-columns: minmax(320px, 0.72fr) minmax(520px, 1.28fr)");
    expect(controlRegionRule).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(controlHeaderRule).toContain("justify-content: space-between");
    expect(controlBodyRule).toContain("grid-template-rows: minmax(130px, 0.42fr) minmax(0, 1fr)");
    expect(expandedControlBodyRule).toContain("grid-template-rows: minmax(220px, 0.56fr) minmax(0, 1fr)");
    expect(css).not.toContain(".app-shell--artifact-expanded {");
  });
```

- [ ] **Step 2: Run TreeableApp tests and verify CSS failure**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected:

- The CSS test fails because the new CSS selectors and grid values do not exist yet.

- [ ] **Step 3: Update desktop app-shell columns**

In `src/app/globals.css`, update `.app-shell`:

```css
.app-shell {
  height: max(100dvh, calc(56px + 12px + 260px + 24px));
  display: grid;
  grid-template-columns: minmax(520px, 1.42fr) minmax(320px, 0.58fr);
  grid-template-rows: 56px minmax(260px, 1fr);
  align-items: stretch;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
  transition: grid-template-columns 180ms ease;
}
```

Replace `.app-shell--artifact-expanded` with:

```css
.app-shell--control-expanded {
  grid-template-columns: minmax(320px, 0.72fr) minmax(520px, 1.28fr);
}
```

- [ ] **Step 4: Add desktop control region styles**

Add these desktop styles near the current `.canvas-region--desktop-focus` rules:

```css
.desktop-control-region {
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 8px;
  box-shadow: 0 18px 55px rgba(15, 23, 42, 0.1);
}

.desktop-control-region__header {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

.desktop-control-region__header strong {
  color: var(--ink);
  font-size: 0.88rem;
  font-weight: 900;
}

.desktop-control-toggle {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  color: #075985;
  background: #e0f2fe;
  border: 1px solid rgba(14, 116, 144, 0.2);
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 850;
  white-space: nowrap;
}

.desktop-control-region__body {
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(130px, 0.42fr) minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
  overflow: hidden;
}

.app-shell--control-expanded .desktop-control-region__body {
  grid-template-rows: minmax(220px, 0.56fr) minmax(0, 1fr);
}

.desktop-control-region__tree,
.desktop-control-region__options {
  min-height: 0;
  display: grid;
  overflow: hidden;
}

.desktop-control-region__tree .tree-canvas,
.desktop-control-region__options .tree-canvas {
  min-height: 0;
  height: 100%;
  box-shadow: none;
}

.desktop-control-region__options .tree-canvas {
  border: 0;
  background: transparent;
}
```

- [ ] **Step 5: Remove obsolete desktop focus styles or stop referencing them**

Remove CSS blocks that are only used by the deleted desktop focus layout:

```css
.app-shell--artifact-expanded { ... }
.canvas-region--desktop-focus { ... }
.canvas-region--desktop-focus-tree-open { ... }
.desktop-tree-toggle { ... }
.desktop-tree-toggle__button { ... }
.desktop-tree-toggle__button[aria-expanded="true"] { ... }
.desktop-focus-tree-region,
.desktop-focus-options-region { ... }
.app-shell--artifact-expanded .desktop-focus-tree-region .tree-canvas--tree { ... }
.app-shell--artifact-expanded .desktop-focus-tree-region .tree-viewport-shell { ... }
.app-shell--artifact-expanded .desktop-focus-options-region .tree-canvas--options { ... }
.app-shell--artifact-expanded .tree-canvas--options .branch-option-tray { ... }
.app-shell--artifact-expanded .tree-canvas--options .branch-option-question { ... }
.app-shell--artifact-expanded .tree-canvas--options .branch-option-main { ... }
.app-shell--artifact-expanded .tree-canvas--options .branch-card--option:not(.branch-card--side) { ... }
.app-shell--artifact-expanded .tree-canvas--options .branch-option-focus { ... }
.app-shell--artifact-expanded .tree-canvas--options .branch-option-focus__composer { ... }
.app-shell--artifact-expanded .tree-canvas--options .branch-option-focus__composer .branch-option-composer { ... }
.app-shell--artifact-expanded .tree-canvas--options .branch-option-focus__others { ... }
```

If a selector is still used by mobile CSS or non-desktop flows, keep it and update the selector to `.desktop-control-region__options` instead of deleting it.

- [ ] **Step 6: Run TreeableApp tests and verify pass**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected:

- `TreeableApp.test.tsx` passes.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/app/globals.css src/components/TreeableApp.test.tsx
git commit -m "style: update desktop control layout"
```

---

### Task 5: Full Verification

**Files:**
- Verify only; modify files only if tests reveal issues.

- [ ] **Step 1: Run focused suites**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx src/components/tree/TreeCanvas.test.tsx
```

Expected:

- Both focused suites pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected:

- All Vitest tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

- TypeScript exits with no errors.

- [ ] **Step 4: Run a production build**

Run:

```bash
npm run build
```

Expected:

- Next.js build completes without errors.

- [ ] **Step 5: Browser verification**

Run the dev server:

```bash
npm run dev
```

Open the app in the in-app browser at the printed localhost URL.

Verify:

- Desktop loads with artifact on the left and control region on the right.
- Default button label is `展开控制区`.
- Default tree shows nodes/links without visual node labels.
- Clicking `展开控制区` makes the right control region larger and shows tree labels.
- Clicking `收起控制区` returns to left-large/right-small and compact tree labels.
- The custom direction row has only one input and one send button.
- Sending a custom direction creates a custom option and clears the input.
- Mobile viewport still shows the existing mobile tree toggle and artifact/options flow.

- [ ] **Step 6: Final commit**

If verification required fixes, commit them:

```bash
git add src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx src/components/tree/TreeCanvas.tsx src/components/tree/TreeCanvas.test.tsx src/app/globals.css
git commit -m "fix: complete left artifact right control layout"
```

If no fixes were needed after prior task commits, skip this commit.

---

## Self-Review

Spec coverage:

- Permanent left artifact / right control desktop layout is covered by Task 2 and Task 4.
- Default artifact-focused state is covered by Task 2 tests and Task 4 CSS.
- Single right-header toggle is covered by Task 2.
- Toggle coupling between column width and tree detail mode is covered by Task 2 and Task 1.
- Compact tree with hidden visual labels but preserved titles is covered by Task 1.
- Compact custom direction input plus send button is covered by Task 3.
- Mobile non-change requirement is covered by Task 2 preserving mobile render branches and Task 5 browser verification.

Placeholder scan:

- No placeholder red flags are present.
- Each code-changing step includes concrete code or exact selector replacements.

Type consistency:

- The plan uses `treeLabelMode?: "compact" | "detail"` consistently.
- The desktop state is `isControlPanelExpanded` consistently.
- The right toggle labels are `展开控制区` and `收起控制区` consistently.

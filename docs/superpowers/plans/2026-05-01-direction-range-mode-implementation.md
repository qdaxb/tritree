# Direction Range Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `发散 / 平衡 / 专注` a visible direction-range control that affects the next generated directions without promising draft rewrite size.

**Architecture:** Keep the existing `OptionGenerationMode` domain type and persistence contract. Move the UI control to `BranchOptionTray`, pass the selected mode through option choice and option generation requests, and update AI context copy so mode means direction range. Existing draft-generation context may receive the mode as background, but prompt copy must say draft change size comes from the selected option.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library, existing API routes and repository.

---

## File Structure

- Modify `src/components/tree/TreeCanvas.tsx`: own tray-level `optionMode`, render one controlled `方向范围` segmented control, pass selected mode into option card clicks, and remove the per-card mode selector.
- Modify `src/app/globals.css`: style the tray-level control and active segment.
- Modify `src/lib/app-state.ts`: replace writing-tendency copy with direction-range copy, and allow current-draft option generation to receive a mode.
- Modify `src/components/TreeableApp.tsx`: pass the selected mode into the options-generation request that follows draft generation.
- Modify `src/app/api/sessions/[sessionId]/options/route.ts`: accept `optionMode` and pass it to `summarizeCurrentDraftOptionsForDirector`.
- Modify tests in `src/components/tree/TreeCanvas.test.tsx`, `src/lib/app-state.test.ts`, and `src/app/api/sessions/[sessionId]/options/route.test.ts`.

---

### Task 1: Direction-Range AI Context

**Files:**
- Modify: `src/lib/app-state.ts:12-90`
- Test: `src/lib/app-state.test.ts:40-110`

- [ ] **Step 1: Write failing tests for direction-range copy**

In `src/lib/app-state.test.ts`, replace the mode expectations in `includes user notes for the selected option` with:

```ts
    expect(summary.selectedOptionLabel).toContain("职场黑话");
    expect(summary.selectedOptionLabel).toContain("用户补充要求：请保留一点讽刺感。");
    expect(summary.selectedOptionLabel).toContain("方向范围：专注");
    expect(summary.selectedOptionLabel).toContain("围绕当前稿最重要的未解决写作判断");
    expect(summary.selectedOptionLabel).toContain("草稿改动幅度由所选方向决定");
    expect(summary.selectedOptionLabel).not.toContain("本轮写作倾向");
    expect(summary.selectedOptionLabel).not.toContain("收窄和深化");
```

Add this new test after that case:

```ts
  it("summarizes current-draft option generation with a direction range", () => {
    const state = createStateWithPath([
      createNode({
        id: "root",
        roundIndex: 1,
        options: [
          option("a", "确定表达主线"),
          option("b", "选择读者视角"),
          option("c", "整理故事推进")
        ],
        selectedOptionId: "b",
        foldedOptions: [option("a", "确定表达主线"), option("c", "整理故事推进")]
      })
    ]);

    const summary = summarizeCurrentDraftOptionsForDirector(state, "divergent");

    expect(summary.selectedOptionLabel).toContain("当前内容；避免重复已有方向和已有建议。");
    expect(summary.selectedOptionLabel).toContain("方向范围：发散");
    expect(summary.selectedOptionLabel).toContain("拉开下一步方向之间的语义距离");
    expect(summary.selectedOptionLabel).toContain("草稿改动幅度由所选方向决定");
    expect(summary.selectedOptionLabel).not.toContain("大改");
    expect(summary.selectedOptionLabel).not.toContain("小改");
  });
```

- [ ] **Step 2: Run app-state tests to verify failure**

Run:

```bash
npm test -- src/lib/app-state.test.ts
```

Expected: FAIL because `summarizeCurrentDraftOptionsForDirector` does not accept `OptionGenerationMode` and current copy still says `本轮写作倾向`.

- [ ] **Step 3: Implement direction-range context**

In `src/lib/app-state.ts`, update `summarizeSessionForDirector` and `summarizeCurrentDraftOptionsForDirector`:

```ts
export function summarizeSessionForDirector(
  state: SessionState,
  selectedOption?: BranchOption,
  selectedOptionNote?: string,
  optionMode: OptionGenerationMode = "balanced"
): DirectorInputParts {
  const trimmedNote = selectedOptionNote?.trim();
  const modeHint = formatDirectionRangeHint(optionMode);
  const selectedOptionLabel = formatWritingIntentLabel(selectedOption, trimmedNote, modeHint);

  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentDraft: state.currentDraft ? formatDraftForDirector(state.currentDraft) : "",
    pathSummary: formatPathForDirector(state),
    foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: buildDraftConversationMessages(
      state,
      formatDraftUserRequest({
        currentDraft: state.currentDraft,
        modeHint,
        selectedOption,
        selectedOptionNote: trimmedNote
      })
    )
  };
}

export function summarizeCurrentDraftOptionsForDirector(
  state: SessionState,
  optionMode: OptionGenerationMode = "balanced"
): DirectorInputParts {
  const selectedOptionLabel = [
    "当前内容；避免重复已有方向和已有建议。",
    formatDirectionRangeHint(optionMode)
  ].join("\n");

  return {
    rootSummary: state.rootMemory.summary,
    learnedSummary: state.rootMemory.learnedSummary,
    currentDraft: state.currentDraft ? formatDraftForDirector(state.currentDraft) : "",
    pathSummary: formatPathForDirector(state),
    foldedSummary: formatCurrentPathFoldedOptionsForDirector(state),
    selectedOptionLabel,
    enabledSkills: enabledSkillsForDirector(state),
    messages: buildEditorMessages(state, state.currentDraft)
  };
}
```

Replace `formatWritingModeHint` with:

```ts
function formatDirectionRangeHint(optionMode: OptionGenerationMode) {
  if (optionMode === "divergent") {
    return "方向范围：发散。拉开下一步方向之间的语义距离，可以尝试更明显的角度、读者、结构或前提变化。模式只影响方向范围；草稿改动幅度由所选方向决定。";
  }

  if (optionMode === "focused") {
    return "方向范围：专注。围绕当前稿最重要的未解决写作判断，给出更贴近当前稿的推进路线。模式只影响方向范围；草稿改动幅度由所选方向决定。";
  }

  return "方向范围：平衡。兼顾当前稿的延展和推进，给出既不太跳脱也不只做局部修补的路线。模式只影响方向范围；草稿改动幅度由所选方向决定。";
}
```

- [ ] **Step 4: Run app-state tests to verify pass**

Run:

```bash
npm test -- src/lib/app-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit AI context change**

Run:

```bash
git add src/lib/app-state.ts src/lib/app-state.test.ts
git commit -m "feat: clarify direction range AI context"
```

Expected: commit succeeds.

---

### Task 2: Options Request Mode Propagation

**Files:**
- Modify: `src/app/api/sessions/[sessionId]/options/route.ts:10-70`
- Modify: `src/components/TreeableApp.tsx:720-840`
- Test: `src/app/api/sessions/[sessionId]/options/route.test.ts`

- [ ] **Step 1: Write failing route test for option mode**

In `src/app/api/sessions/[sessionId]/options/route.test.ts`, add this test after `streams partial options before persisting and sending done`:

```ts
  it("passes option mode into current-draft option generation", async () => {
    const output = {
      roundIntent: "下一步",
      options: [
        { id: "a", label: "换角度", description: "A", impact: "A", kind: "reframe" },
        { id: "b", label: "换读者", description: "B", impact: "B", kind: "explore" },
        { id: "c", label: "换结构", description: "C", impact: "C", kind: "deepen" }
      ],
      memoryObservation: "偏好具体表达。"
    };
    const updateNodeOptions = vi.fn().mockReturnValue(state);
    getRepositoryMock.mockReturnValue({
      getSessionState: vi.fn().mockReturnValue(state),
      updateNodeOptions
    });
    streamDirectorOptionsMock.mockResolvedValue(output);

    const response = await POST(
      new Request("http://test.local/api/sessions/session-1/options", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node-1", optionMode: "divergent" })
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    await response.text();

    expect(streamDirectorOptionsMock).toHaveBeenCalled();
    expect(streamDirectorOptionsMock.mock.calls[0][0].selectedOptionLabel).toContain("方向范围：发散");
    expect(streamDirectorOptionsMock.mock.calls[0][0].selectedOptionLabel).toContain("拉开下一步方向之间的语义距离");
  });
```

- [ ] **Step 2: Run route test to verify failure**

Run:

```bash
npm test -- 'src/app/api/sessions/[sessionId]/options/route.test.ts'
```

Expected: FAIL because `OptionsBodySchema` ignores `optionMode` and the summary always uses the balanced default.

- [ ] **Step 3: Implement route propagation**

In `src/app/api/sessions/[sessionId]/options/route.ts`, import `OptionGenerationModeSchema`:

```ts
import { OptionGenerationModeSchema } from "@/lib/domain";
```

Change `OptionsBodySchema` to:

```ts
const OptionsBodySchema = z.object({
  nodeId: z.string().min(1),
  optionMode: OptionGenerationModeSchema.default("balanced")
});
```

Change the streaming call to:

```ts
const output = await streamDirectorOptions(summarizeCurrentDraftOptionsForDirector(focusedState, body.optionMode), {
  memory: { resource: state.rootMemory.id, thread: sessionId },
  signal: request.signal,
  onText(event) {
    if (event.partialOptions) {
      send({ type: "options", nodeId: body.nodeId, options: event.partialOptions });
    }
  }
});
```

- [ ] **Step 4: Pass mode from client to options generation**

In `src/components/TreeableApp.tsx`, change `ensureNodeOptions` to accept and send mode:

```ts
async function ensureNodeOptions(
  state: SessionState,
  nodeId: string | null,
  optionMode: OptionGenerationMode = "balanced"
) {
  if (!needsNodeOptions(state, nodeId)) return state;
  if (!nodeId) return state;

  setGenerationStage({ nodeId, stage: "options" });
  setStreamingOptions({ nodeId, options: [] });
  const response = await fetch(`/api/sessions/${state.session.id}/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nodeId,
      ...(optionMode !== "balanced" ? { optionMode } : {})
    })
  });
```

In `finishNodeGeneration`, pass the same selected mode:

```ts
const optionsState = await ensureNodeOptions(nextState, nextState.currentNode?.id ?? nodeId, optionMode);
```

Leave `viewNode` as:

```ts
const optionsState = await ensureNodeOptions(sessionState, nodeId);
```

because revisiting an unfinished historical node has no active tray selection.

- [ ] **Step 5: Run focused route test**

Run:

```bash
npm test -- 'src/app/api/sessions/[sessionId]/options/route.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit propagation change**

Run:

```bash
git add 'src/app/api/sessions/[sessionId]/options/route.ts' 'src/app/api/sessions/[sessionId]/options/route.test.ts' src/components/TreeableApp.tsx
git commit -m "feat: pass direction range to option generation"
```

Expected: commit succeeds.

---

### Task 3: Tray-Level Direction Range Control

**Files:**
- Modify: `src/components/tree/TreeCanvas.tsx:1040-1245`
- Modify: `src/app/globals.css:1190-1265`
- Test: `src/components/tree/TreeCanvas.test.tsx:170-250`

- [ ] **Step 1: Write failing UI tests**

In `src/components/tree/TreeCanvas.test.tsx`, add this test after `passes per-option notes to the chosen branch`:

```ts
  it("uses one tray-level direction range control for choosing option mode", () => {
    const onChoose = vi.fn();
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={onChoose}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    const tray = screen.getByRole("group", { name: "下一步方向选项" });
    const range = within(tray).getByRole("group", { name: "方向范围" });

    expect(within(range).getByRole("button", { name: "发散 给我更远、更不一样的路线" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(within(range).getByRole("button", { name: "平衡 兼顾延展和当前稿推进" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("兼顾延展和当前稿推进")).toBeInTheDocument();

    fireEvent.click(within(range).getByRole("button", { name: "发散 给我更远、更不一样的路线" }));

    expect(within(range).getByRole("button", { name: "发散 给我更远、更不一样的路线" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("给我更远、更不一样的路线")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /A 具体场景/ }));

    expect(onChoose).toHaveBeenCalledWith("a", "", "divergent");
  });
```

Add this test after it:

```ts
  it("keeps expanded option panels focused on notes instead of duplicating mode controls", () => {
    render(
      <BranchOptionTray
        isBusy={false}
        onChoose={vi.fn()}
        options={currentNode.options}
        pendingChoice={null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "A 更多备注" }));

    expect(screen.getByLabelText("更多备注 A")).toBeInTheDocument();
    expect(screen.getAllByRole("group", { name: "方向范围" })).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "A 生成倾向" })).not.toBeInTheDocument();
  });
```

Update the existing `passes per-option notes to the chosen branch` expectation to keep the balanced default:

```ts
    expect(onChoose).toHaveBeenCalledWith("a", "请用更尖锐一点的对比。", "balanced");
```

- [ ] **Step 2: Run TreeCanvas test to verify failure**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected: FAIL because the tray does not render `方向范围`, the card click hard-codes `balanced`, and the expanded panel still renders `A 生成倾向`.

- [ ] **Step 3: Implement tray-level state and control**

In `src/components/tree/TreeCanvas.tsx`, add mode state to `BranchOptionTray` and pass it to cards:

```tsx
  const [optionNotes, setOptionNotes] = useState<Partial<Record<BranchOption["id"], string>>>({});
  const [optionMode, setOptionMode] = useState<OptionGenerationMode>("balanced");
  const orderedOptions = orderBranchOptions(options);
  const primaryOptions = orderedOptions.filter((option) => isPrimaryBranchOptionId(option.id));
  const primaryAllVisible = visibleCount >= primaryOptions.length;

  return (
    <div aria-label="下一步方向选项" className="branch-option-tray" role="group">
      {primaryAllVisible ? (
        <div className="branch-option-tray__controls">
          <OptionModeControl disabled={isBusy} mode={optionMode} onModeChange={setOptionMode} />
        </div>
      ) : null}
      <div aria-label="三个主选项" className="branch-option-main branch-option-main--horizontal" role="group">
        {primaryOptions.map((option, index) =>
          index < visibleCount ? (
            <BranchOptionCard
              isBusy={isBusy || !primaryAllVisible}
              isPending={pendingChoice === option.id}
              key={option.id}
              note={optionNotes[option.id] ?? ""}
              onNoteChange={(note) => setOptionNotes((notes) => ({ ...notes, [option.id]: note }))}
              onChoose={onChoose}
              option={option}
              optionMode={optionMode}
            />
          ) : (
            <BranchOptionPlaceholder key={option.id} optionId={option.id} />
          )
        )}
      </div>
      <div aria-label="旁路设置" className="branch-option-side" role="group">
        {primaryAllVisible ? (
          <MoreDirectionsCard disabled={isBusy} onAddCustomOption={onAddCustomOption} skills={skills} />
        ) : null}
      </div>
    </div>
  );
```

Replace `OptionModeControl` with:

```tsx
const DIRECTION_RANGE_OPTIONS: Array<{ description: string; label: string; value: OptionGenerationMode }> = [
  { label: "发散", value: "divergent", description: "给我更远、更不一样的路线" },
  { label: "平衡", value: "balanced", description: "兼顾延展和当前稿推进" },
  { label: "专注", value: "focused", description: "围绕当前稿继续收窄" }
];

function OptionModeControl({
  disabled,
  mode,
  onModeChange
}: {
  disabled: boolean;
  mode: OptionGenerationMode;
  onModeChange: (mode: OptionGenerationMode) => void;
}) {
  const activeOption = DIRECTION_RANGE_OPTIONS.find((item) => item.value === mode) ?? DIRECTION_RANGE_OPTIONS[1];

  return (
    <div className="option-mode-control-wrap">
      <span className="option-mode-control__label">方向范围</span>
      <div aria-label="方向范围" className="option-mode-control" role="group">
        {DIRECTION_RANGE_OPTIONS.map((item) => (
          <button
            aria-label={`${item.label} ${item.description}`}
            aria-pressed={mode === item.value}
            className={clsx("option-mode-control__button", mode === item.value && "option-mode-control__button--active")}
            disabled={disabled}
            key={item.value}
            onClick={() => onModeChange(item.value)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <span className="option-mode-control__hint">{activeOption.description}</span>
    </div>
  );
}
```

Update `BranchOptionCard` props and main click:

```tsx
  option,
  optionMode,
  variant = "primary"
}: {
  isBusy: boolean;
  isPending: boolean;
  note: string;
  onChoose: (optionId: BranchOption["id"], note?: string, optionMode?: OptionGenerationMode) => void;
  onNoteChange: (note: string) => void;
  option: BranchOption;
  optionMode: OptionGenerationMode;
  variant?: "primary" | "side";
}) {
```

```tsx
        onClick={() => onChoose(option.id, note.trim(), optionMode)}
```

Remove this block from the expanded panel:

```tsx
          <div aria-label={`${choiceLabel} 生成倾向`} className="branch-card__mode" role="group">
            <OptionModeControl
              disabled={isBusy}
              onChooseMode={(mode) => onChoose(option.id, note.trim(), mode)}
            />
          </div>
```

- [ ] **Step 4: Style the tray-level control**

In `src/app/globals.css`, add or update these rules near the existing option mode styles:

```css
.branch-option-tray__controls {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-height: 34px;
}

.option-mode-control-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: rgba(71, 85, 105, 0.76);
}

.option-mode-control__label {
  color: rgba(15, 23, 42, 0.72);
  font-size: 0.74rem;
  font-weight: 840;
  white-space: nowrap;
}

.option-mode-control {
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 999px;
  background: rgba(248, 250, 252, 0.9);
}

.option-mode-control__button {
  min-height: 26px;
  padding: 0 10px;
  color: rgba(71, 85, 105, 0.72);
  background: transparent;
  border: 0;
  font-size: 0.72rem;
  font-weight: 800;
}

.option-mode-control__button--active {
  color: #0f766e;
  background: #ccfbf1;
}

.option-mode-control__hint {
  min-width: 0;
  color: rgba(71, 85, 105, 0.72);
  font-size: 0.72rem;
  font-weight: 720;
  white-space: nowrap;
}
```

Remove `.branch-card__mode` only if no code still uses it after the UI change.

- [ ] **Step 5: Run TreeCanvas test to verify pass**

Run:

```bash
npm test -- src/components/tree/TreeCanvas.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit UI change**

Run:

```bash
git add src/components/tree/TreeCanvas.tsx src/components/tree/TreeCanvas.test.tsx src/app/globals.css
git commit -m "feat: add tray direction range control"
```

Expected: commit succeeds.

---

### Task 4: Full Verification

**Files:**
- Verify all files touched by Tasks 1-3.

- [ ] **Step 1: Run focused tests together**

Run:

```bash
npm test -- src/lib/app-state.test.ts 'src/app/api/sessions/[sessionId]/options/route.test.ts' src/components/tree/TreeCanvas.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Check worktree status**

Run:

```bash
git status --short
```

Expected: only the pre-existing `M tsconfig.json` remains if it was not part of this work.

---

## Self Review

Spec coverage:

- Visible tray-level `方向范围` control: Task 3.
- Active state, helper text, and default `平衡`: Task 3.
- Option click sends selected mode: Task 3.
- Per-card panel keeps notes only: Task 3.
- Direction-range AI copy without rewrite-size promise: Task 1.
- Existing API and schema compatibility: Task 2 keeps `optionMode` optional with `balanced` default.
- No separate rewrite-strength control: all tasks preserve one mode control.
- No visible option regeneration on mode change: Task 3 updates local state only; Task 2 sends mode on existing generation requests.

Placeholder scan: no task contains open implementation slots.

Type consistency: all mode values use existing `OptionGenerationMode`; new route parsing uses existing `OptionGenerationModeSchema`; UI callbacks keep the existing `onChoose(optionId, note, optionMode)` signature.

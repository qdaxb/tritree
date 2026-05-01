# Creation Goal Implementation Plan

> Amendment after browser review (2026-05-01): the final implementation replaces fixed creation-goal state with one `creationRequest` field. The Seed screen offers SQLite-backed quick request chips plus a collapsed custom textarea, and both write into the same persisted `本次创作要求`. The quick chip library supports add, rename, delete, sort, and reset. Historical task details below describe the earlier fixed-goal design and are superseded for final code.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight work-level creation goal to the Seed screen and feed it into Tritree's existing root memory context.

**Architecture:** Store the creation goal as two new `RootPreferences` fields and keep using `root_memory.preferences_json` for persistence. Format the goal into `rootMemory.summary`, which is already sent to Director generation paths. `RootMemorySetup` owns the new form state; `TreeableApp` passes values through initial setup, first save, and restart-from-current-settings.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Zod, SQLite repository, Vitest, Testing Library.

---

## File Structure

- Modify `src/lib/domain.ts`: extend `RootPreferencesSchema` with `creationGoal` and `creationGoalNote`.
- Modify `src/lib/domain.test.ts`: cover trimming/default compatibility for the new preference fields.
- Modify `src/lib/db/repository.ts`: include goal fields in `summarizePreferences`.
- Modify `src/lib/db/repository.test.ts`: cover persisted summary formatting.
- Modify `src/components/root-memory/RootMemorySetup.tsx`: render the goal selector and include fields in submit payload.
- Modify `src/components/root-memory/RootMemorySetup.test.tsx`: cover rendering, submission, and prefilled values.
- Modify `src/components/TreeableApp.tsx`: pass initial goal values into setup, preserve them on restart, and display persisted summary.
- Modify `src/components/TreeableApp.test.tsx`: cover first-generation payload and restart prefill.
- Modify `src/app/globals.css`: style the goal section consistently with the existing Seed screen.
- Modify `src/app/api/sessions/route.test.ts`: add a regression proving the seed draft body remains the raw seed while root summary includes goal context.

---

### Task 1: Root Preference Model and Summary

**Files:**
- Modify: `src/lib/domain.ts`
- Modify: `src/lib/domain.test.ts`
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/db/repository.test.ts`

- [ ] **Step 1: Write the failing schema test**

Add this test inside `describe("RootPreferencesSchema", ...)` in `src/lib/domain.test.ts`, after the existing `"keeps old preference rows readable when seed is missing"` test:

```ts
  it("defaults and trims creation goal fields", () => {
    const result = RootPreferencesSchema.parse({
      seed: "我想写 AI 产品经理的真实困境",
      creationGoal: " 改成可发布 ",
      creationGoalNote: " 写给正在做 AI 产品的人，语气克制一点 ",
      domains: ["AI", "product"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(result.creationGoal).toBe("改成可发布");
    expect(result.creationGoalNote).toBe("写给正在做 AI 产品的人，语气克制一点");

    const legacy = RootPreferencesSchema.parse({
      seed: "旧 seed",
      domains: ["AI"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(legacy.creationGoal).toBe("");
    expect(legacy.creationGoalNote).toBe("");
  });
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run:

```bash
npm test -- src/lib/domain.test.ts
```

Expected: FAIL because `creationGoal` and `creationGoalNote` are not returned by `RootPreferencesSchema` yet.

- [ ] **Step 3: Implement the preference fields**

In `src/lib/domain.ts`, replace the current `RootPreferencesSchema` definition with:

```ts
export const RootPreferencesSchema = z.object({
  seed: z.string().trim().default(""),
  creationGoal: z.string().trim().max(40).default(""),
  creationGoalNote: z.string().trim().max(240).default(""),
  domains: z.array(z.string().min(1)).min(1),
  tones: z.array(z.string().min(1)).min(1),
  styles: z.array(z.string().min(1)).min(1),
  personas: z.array(z.string().min(1)).min(1)
});
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run:

```bash
npm test -- src/lib/domain.test.ts
```

Expected: PASS for all tests in `src/lib/domain.test.ts`.

- [ ] **Step 5: Write the failing repository summary test**

In `src/lib/db/repository.test.ts`, add this test after `"saves and reads root memory"`:

```ts
  it("includes creation goal details in root memory summary", () => {
    const repo = createTreeableRepository(testDbPath());

    const root = repo.saveRootMemory({
      seed: "我想写 AI 产品经理的真实困境",
      creationGoal: "改成可发布",
      creationGoalNote: "写给正在做 AI 产品的人，语气克制一点",
      domains: ["AI", "product"],
      tones: ["calm"],
      styles: ["opinion-driven"],
      personas: ["practitioner"]
    });

    expect(root.summary).toBe(
      [
        "Seed：我想写 AI 产品经理的真实困境",
        "创作目标：改成可发布",
        "目标补充：写给正在做 AI 产品的人，语气克制一点"
      ].join("\n")
    );
    expect(root.preferences.creationGoal).toBe("改成可发布");
    expect(root.preferences.creationGoalNote).toBe("写给正在做 AI 产品的人，语气克制一点");
  });
```

- [ ] **Step 6: Run the repository summary test to verify it fails**

Run:

```bash
npm test -- src/lib/db/repository.test.ts
```

Expected: FAIL because `summarizePreferences` still formats only the seed.

- [ ] **Step 7: Implement root memory summary formatting**

In `src/lib/db/repository.ts`, replace `summarizePreferences` with:

```ts
function summarizePreferences(preferences: RootPreferences) {
  const seed = preferences.seed?.trim();
  const creationGoal = preferences.creationGoal?.trim();
  const creationGoalNote = preferences.creationGoalNote?.trim();
  const goalParts = [
    creationGoal ? `创作目标：${creationGoal}` : "",
    creationGoalNote ? `目标补充：${creationGoalNote}` : ""
  ].filter(Boolean);

  if (seed) {
    return [`Seed：${seed}`, ...goalParts].join("\n");
  }

  return [
    [
      `领域：${preferences.domains.join("、")}`,
      `语气：${preferences.tones.join("、")}`,
      `表达：${preferences.styles.join("、")}`,
      `视角：${preferences.personas.join("、")}`
    ].join(" | "),
    ...goalParts
  ].join("\n");
}
```

- [ ] **Step 8: Run focused model and repository tests**

Run:

```bash
npm test -- src/lib/domain.test.ts src/lib/db/repository.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add src/lib/domain.ts src/lib/domain.test.ts src/lib/db/repository.ts src/lib/db/repository.test.ts
git commit -m "feat: persist creation goal preferences"
```

Expected: commit succeeds.

---

### Task 2: Seed Screen Goal Controls

**Files:**
- Modify: `src/components/root-memory/RootMemorySetup.tsx`
- Modify: `src/components/root-memory/RootMemorySetup.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write the failing render and submit tests**

In `src/components/root-memory/RootMemorySetup.test.tsx`, add these tests after `"submits the seed without requiring a first guide"`:

```tsx
  it("lets the user choose a creation goal and submit an optional goal note", async () => {
    const onSubmit = vi.fn();
    render(<RootMemorySetup onManageSkills={vi.fn()} onSubmit={onSubmit} isSaving={false} skills={skills} />);

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "我想写 AI 产品经理的真实困境");
    await userEvent.click(screen.getByRole("button", { name: "改成可发布" }));
    await userEvent.type(screen.getByRole("textbox", { name: "补充目标" }), "写给正在做 AI 产品的人，语气克制一点");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(screen.getByRole("group", { name: "这次创作的目标" })).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        seed: "我想写 AI 产品经理的真实困境",
        creationGoal: "改成可发布",
        creationGoalNote: "写给正在做 AI 产品的人，语气克制一点"
      }),
      enabledSkillIds: ["system-analysis"]
    });
  });

  it("can start with creation goal defaults already filled in", async () => {
    const onSubmit = vi.fn();
    render(
      <RootMemorySetup
        initialSeed="继续写当前这个念头"
        initialCreationGoal="找表达角度"
        initialCreationGoalNote="从产品实践者视角写"
        initialSkillIds={["system-no-hype-title"]}
        onManageSkills={vi.fn()}
        onSubmit={onSubmit}
        isSaving={false}
        skills={skills}
      />
    );

    expect(screen.getByRole("button", { name: "找表达角度" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "补充目标" })).toHaveValue("从产品实践者视角写");

    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        seed: "继续写当前这个念头",
        creationGoal: "找表达角度",
        creationGoalNote: "从产品实践者视角写"
      }),
      enabledSkillIds: ["system-no-hype-title"]
    });
  });
```

- [ ] **Step 2: Run the Seed screen tests to verify they fail**

Run:

```bash
npm test -- src/components/root-memory/RootMemorySetup.test.tsx
```

Expected: FAIL because the goal controls and props do not exist.

- [ ] **Step 3: Add goal state and props**

In `src/components/root-memory/RootMemorySetup.tsx`, add this constant after `defaultPreferences`:

```ts
const creationGoalOptions = ["理清观点", "写成初稿", "改成可发布", "找表达角度", "面向特定读者"] as const;
```

Update the component props destructuring to include:

```ts
  initialCreationGoal = "",
  initialCreationGoalNote = "",
```

Update the props type block with:

```ts
  initialCreationGoal?: string;
  initialCreationGoalNote?: string;
```

Add state after `const [seed, setSeed] = useState(initialSeed);`:

```ts
  const [creationGoal, setCreationGoal] = useState(initialCreationGoal);
  const [creationGoalNote, setCreationGoalNote] = useState(initialCreationGoalNote);
```

Add trimmed values after `const trimmedSeed = seed.trim();`:

```ts
  const trimmedCreationGoal = creationGoal.trim();
  const trimmedCreationGoalNote = creationGoalNote.trim();
```

- [ ] **Step 4: Render the goal section**

In `src/components/root-memory/RootMemorySetup.tsx`, render this block after the closing `</label>` for `seed-field` and before the `<section aria-label="本作品启用技能"...>` block:

```tsx
        <section aria-label="这次创作的目标" className="root-setup__goal">
          <div>
            <p className="eyebrow">这次创作的目标</p>
            <p className="root-setup__goal-copy">选一个方向感，AI 会按这个目标生成第一组三个分支。</p>
          </div>
          <div aria-label="目标选项" className="root-setup__goal-options" role="group">
            {creationGoalOptions.map((option) => (
              <button
                aria-pressed={creationGoal === option}
                className={`goal-chip${creationGoal === option ? " goal-chip--active" : ""}`}
                disabled={isSaving}
                key={option}
                onClick={() => setCreationGoal(option)}
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
          <label className="goal-note-field">
            <span>补充目标</span>
            <textarea
              aria-label="补充目标"
              disabled={isSaving}
              onChange={(event) => setCreationGoalNote(event.target.value)}
              placeholder="例如：写给正在做 AI 产品的人，语气克制一点"
              rows={2}
              value={creationGoalNote}
            />
          </label>
        </section>
```

- [ ] **Step 5: Include goal fields in submit payload**

In the `onClick` handler for the primary submit button in `src/components/root-memory/RootMemorySetup.tsx`, update the `preferences` object to include:

```ts
                creationGoal: trimmedCreationGoal,
                creationGoalNote: trimmedCreationGoalNote,
```

The complete `preferences` block should be:

```ts
              preferences: {
                ...defaultPreferences,
                seed: trimmedSeed,
                creationGoal: trimmedCreationGoal,
                creationGoalNote: trimmedCreationGoalNote
              },
```

- [ ] **Step 6: Add goal styles**

In `src/app/globals.css`, add these styles after the `.seed-field textarea:focus` block:

```css
.root-setup__goal {
  display: grid;
  gap: 12px;
  margin: 16px 0 18px;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 8px;
}

.root-setup__goal-copy {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1.35;
}

.root-setup__goal-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.goal-chip {
  min-height: 36px;
  padding: 7px 11px;
  color: #334155;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 8px;
  font-weight: 750;
  transition: transform 160ms ease, opacity 160ms ease, background 160ms ease, border-color 160ms ease;
}

.goal-chip--active {
  color: #0f766e;
  background: #d9f7f1;
  border-color: rgba(15, 118, 110, 0.42);
}

.goal-note-field {
  display: grid;
  gap: 8px;
}

.goal-note-field span {
  font-size: 0.88rem;
  font-weight: 850;
}

.goal-note-field textarea {
  width: 100%;
  resize: vertical;
  min-height: 74px;
  padding: 12px;
  color: var(--ink);
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 8px;
  line-height: 1.5;
  outline: none;
}

.goal-note-field textarea:focus {
  border-color: rgba(37, 99, 235, 0.54);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}
```

- [ ] **Step 7: Run the Seed screen tests**

Run:

```bash
npm test -- src/components/root-memory/RootMemorySetup.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add src/components/root-memory/RootMemorySetup.tsx src/components/root-memory/RootMemorySetup.test.tsx src/app/globals.css
git commit -m "feat: add creation goal seed controls"
```

Expected: commit succeeds.

---

### Task 3: App Flow Integration

**Files:**
- Modify: `src/components/TreeableApp.tsx`
- Modify: `src/components/TreeableApp.test.tsx`

- [ ] **Step 1: Write the failing first-generation payload assertion**

In `src/components/TreeableApp.test.tsx`, update the `"starts the first generation immediately after the seed is saved"` test.

Replace the existing root-memory mock response for the third fetch with:

```ts
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rootMemory: {
            ...rootMemory,
            preferences: {
              ...rootMemory.preferences,
              creationGoal: "改成可发布",
              creationGoalNote: "写给正在做 AI 产品的人，语气克制一点"
            },
            summary: [
              "Seed：我想写 AI 产品经理的真实困境",
              "创作目标：改成可发布",
              "目标补充：写给正在做 AI 产品的人，语气克制一点"
            ].join("\n")
          }
        })
      })
```

Add these user actions before clicking `用这个念头开始`:

```ts
    await userEvent.click(screen.getByRole("button", { name: "改成可发布" }));
    await userEvent.type(screen.getByRole("textbox", { name: "补充目标" }), "写给正在做 AI 产品的人，语气克制一点");
```

Replace the root-memory request body assertion with:

```ts
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual(
      expect.objectContaining({
        seed: "我想写 AI 产品经理的真实困境",
        creationGoal: "改成可发布",
        creationGoalNote: "写给正在做 AI 产品的人，语气克制一点"
      })
    );
```

Add this display assertion after the existing `findByText("Seed：...")` assertion:

```ts
    expect(await screen.findByText(/创作目标：改成可发布/)).toBeInTheDocument();
```

- [ ] **Step 2: Write the failing restart prefill assertion**

In `src/components/TreeableApp.test.tsx`, update the `"restarts from the seed screen with the current seed and skills preselected"` test.

Create this constant at the start of the test:

```ts
    const rootMemoryWithGoal = {
      ...rootMemory,
      preferences: {
        ...rootMemory.preferences,
        creationGoal: "找表达角度",
        creationGoalNote: "从产品实践者视角写"
      },
      summary: [
        "Seed：我想写 AI 产品经理的真实困境",
        "创作目标：找表达角度",
        "目标补充：从产品实践者视角写"
      ].join("\n")
    };
```

Use `rootMemoryWithGoal` in the second fetch mock:

```ts
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rootMemory: rootMemoryWithGoal }) })
```

After the existing seed textbox assertion, add:

```ts
    expect(screen.getByRole("button", { name: "找表达角度" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "补充目标" })).toHaveValue("从产品实践者视角写");
```

- [ ] **Step 3: Run the app tests to verify they fail**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected: FAIL because `TreeableApp` does not pass or preserve goal fields yet.

- [ ] **Step 4: Extend setup defaults and pass initial goal props**

In `src/components/TreeableApp.tsx`, replace the `RootSetupDefaults` type with:

```ts
type RootSetupDefaults = {
  creationGoal?: string;
  creationGoalNote?: string;
  enabledSkillIds?: string[];
  seed: string;
};
```

In the `RootMemorySetup` render block, add props:

```tsx
          initialCreationGoal={rootSetupDefaults?.creationGoal}
          initialCreationGoalNote={rootSetupDefaults?.creationGoalNote}
```

- [ ] **Step 5: Preserve goal fields on restart**

In `src/components/TreeableApp.tsx`, replace `restartFromCurrentSettings` with:

```ts
  function restartFromCurrentSettings() {
    const preferences = rootMemory?.preferences ?? sessionState?.rootMemory.preferences;
    openSeedSetup({
      seed: preferences?.seed ?? "",
      creationGoal: preferences?.creationGoal ?? "",
      creationGoalNote: preferences?.creationGoalNote ?? "",
      enabledSkillIds: sessionState?.enabledSkillIds ?? []
    });
  }
```

- [ ] **Step 6: Show persisted summary in the topbar**

In `src/components/TreeableApp.tsx`, replace `formatRootSummary` with:

```ts
function formatRootSummary(rootMemory: RootMemory | null) {
  if (!rootMemory) return "";
  if (rootMemory.summary.trim()) return rootMemory.summary.replace(/\s*\n\s*/g, " | ");
  if (rootMemory.preferences.seed.trim()) return `Seed：${rootMemory.preferences.seed.trim()}`;

  const { preferences } = rootMemory;
  return [
    `领域：${preferences.domains.map(translatePreference).join("、")}`,
    `语气：${preferences.tones.map(translatePreference).join("、")}`,
    `表达：${preferences.styles.map(translatePreference).join("、")}`,
    `视角：${preferences.personas.map(translatePreference).join("、")}`
  ].join(" | ");
}
```

- [ ] **Step 7: Run the app tests**

Run:

```bash
npm test -- src/components/TreeableApp.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/components/TreeableApp.tsx src/components/TreeableApp.test.tsx
git commit -m "feat: carry creation goal through app setup"
```

Expected: commit succeeds.

---

### Task 4: Session Start Regression and Full Verification

**Files:**
- Modify: `src/app/api/sessions/route.test.ts`

- [ ] **Step 1: Add the session route regression test**

In `src/app/api/sessions/route.test.ts`, add this test before `"starts a session with selected enabled skill ids"`:

```ts
  it("keeps the seed draft body raw while passing goal context through root summary", async () => {
    const rootMemoryWithGoal = {
      id: "root",
      preferences: {
        seed: "写一篇解释为什么要写作的文章",
        creationGoal: "改成可发布",
        creationGoalNote: "写给想建立写作习惯的人",
        domains: ["创作"],
        tones: ["平静"],
        styles: ["观点型"],
        personas: ["实践者"]
      },
      summary: [
        "Seed：写一篇解释为什么要写作的文章",
        "创作目标：改成可发布",
        "目标补充：写给想建立写作习惯的人"
      ].join("\n"),
      learnedSummary: "",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    };
    const draftState = {
      rootMemory: rootMemoryWithGoal,
      session: {
        id: "session-1",
        title: "Draft",
        status: "active",
        currentNodeId: "node-1",
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:00:00.000Z"
      },
      currentNode: {
        id: "node-1",
        sessionId: "session-1",
        parentId: null,
        parentOptionId: null,
        roundIndex: 1,
        roundIntent: "选择起始方式",
        options: [],
        selectedOptionId: null,
        foldedOptions: [],
        createdAt: "2026-04-26T00:00:00.000Z"
      },
      currentDraft: createSeedDraft("写一篇解释为什么要写作的文章"),
      nodeDrafts: [{ nodeId: "node-1", draft: createSeedDraft("写一篇解释为什么要写作的文章") }],
      selectedPath: [],
      treeNodes: [],
      enabledSkillIds: ["system-analysis"],
      enabledSkills: resolvedSkills,
      foldedBranches: [],
      publishPackage: null
    };
    const createSessionDraft = vi.fn().mockReturnValue(draftState);
    const updateNodeOptions = vi.fn().mockReturnValue({
      ...draftState,
      currentNode: {
        ...draftState.currentNode,
        options: [
          { id: "a", label: "分析", description: "A", impact: "A", kind: "explore" },
          { id: "b", label: "扩写", description: "B", impact: "B", kind: "deepen" },
          { id: "c", label: "润色", description: "C", impact: "C", kind: "reframe" }
        ]
      }
    });
    getRepositoryMock.mockReturnValue({
      getRootMemory: () => rootMemoryWithGoal,
      defaultEnabledSkillIds: vi.fn(() => ["system-analysis"]),
      resolveSkillsByIds: vi.fn(() => resolvedSkills),
      createSessionDraft,
      updateNodeOptions
    });
    streamDirectorOptionsMock.mockResolvedValue({
      roundIntent: "选择起始方式",
      options: [
        { id: "a", label: "分析", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "扩写", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "润色", description: "C", impact: "C", kind: "reframe" }
      ],
      memoryObservation: ""
    });

    const response = await POST(new Request("http://test.local/api/sessions", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(createSessionDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          body: "写一篇解释为什么要写作的文章"
        })
      })
    );
    expect(streamDirectorOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rootSummary: expect.stringContaining("创作目标：改成可发布")
      }),
      expect.anything()
    );
  });
```

- [ ] **Step 2: Run the session route test**

Run:

```bash
npm test -- src/app/api/sessions/route.test.ts
```

Expected: PASS. This is a regression test for behavior that should already be true after previous tasks.

- [ ] **Step 3: Run all focused tests**

Run:

```bash
npm test -- src/lib/domain.test.ts src/lib/db/repository.test.ts src/components/root-memory/RootMemorySetup.test.tsx src/components/TreeableApp.test.tsx src/app/api/sessions/route.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/app/api/sessions/route.test.ts
git commit -m "test: cover creation goal session context"
```

Expected: commit succeeds.

---

## Self-Review

- Spec coverage: The plan covers Seed screen goal UI, predefined single-choice goals, optional note, persistence in `RootPreferences`, root memory summary formatting, topbar visibility, first-round and later AI context through `rootMemory.summary`, no new database table, and tests proving seed draft body stays raw.
- Placeholder scan: The plan contains no deferred implementation markers or unspecified validation steps.
- Type consistency: The plan consistently uses `creationGoal` and `creationGoalNote` across schema, component props, setup defaults, submit payloads, and tests.

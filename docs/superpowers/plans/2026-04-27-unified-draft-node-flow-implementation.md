# Unified Draft Node Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every user or AI draft continuation create a new draft node, and add editable diff saves that use the same user-draft path.

**Architecture:** Add a standard `自定义编辑` branch option and repository methods that create a child node before saving a submitted draft. Keep the existing route names, but make `/draft` create a child node and then generate options for that child. Update `LiveDraft` so normal edit and diff edit both submit a full `Draft` through one save callback.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Testing Library, local SQLite repository.

---

## File Structure

- Modify `src/lib/domain.ts` to export a reusable `CUSTOM_EDIT_OPTION`.
- Modify `src/lib/db/repository.ts` to create custom-edit child nodes and make the old edit update method delegate to the child-node behavior.
- Modify `src/app/api/sessions/[sessionId]/draft/route.ts` to save the submitted draft into a new node, then generate options for that node.
- Modify `src/components/draft/LiveDraft.tsx` to support normal edit and diff edit through one editor path plus small diff revert controls.
- Modify `src/components/TreeableApp.tsx` so draft saves use the viewed node id and refresh missing options consistently.
- Update tests in `src/lib/db/repository.test.ts`, `src/components/draft/LiveDraft.test.tsx`, and `src/components/TreeableApp.test.tsx`.

## Task 1: Repository Custom-Edit Child Nodes

**Files:**
- Modify: `src/lib/domain.ts`
- Modify: `src/lib/db/repository.ts`
- Test: `src/lib/db/repository.test.ts`

- [ ] **Step 1: Write the failing repository test**

Replace the edit test with one that expects a new child:

```ts
it("creates a custom edit child node instead of overwriting the edited node", () => {
  const repo = createTreeableRepository(testDbPath());
  const root = repo.saveRootMemory({
    domains: ["AI"],
    tones: ["calm"],
    styles: ["opinion-driven"],
    personas: ["practitioner"]
  });
  const first = repo.createSessionWithRound({
    rootMemoryId: root.id,
    output: {
      roundIntent: "Start",
      options: [
        { id: "a", label: "A", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "B", description: "B", impact: "B", kind: "explore" },
        { id: "c", label: "C", description: "C", impact: "C", kind: "explore" }
      ],
      draft: { title: "Draft", body: "Body", hashtags: ["#AI"], imagePrompt: "Tree" },
      memoryObservation: "",
      finishAvailable: false,
      publishPackage: null
    }
  });

  const updated = repo.updateCurrentNodeDraftAndOptions({
    sessionId: first.session.id,
    nodeId: first.currentNode!.id,
    draft: { title: "Edited", body: "Edited body", hashtags: ["#Edited"], imagePrompt: "Edited image" },
    output: {
      roundIntent: "Regenerate from edit",
      options: [
        { id: "a", label: "新A", description: "A", impact: "A", kind: "deepen" },
        { id: "b", label: "新B", description: "B", impact: "B", kind: "reframe" },
        { id: "c", label: "新C", description: "C", impact: "C", kind: "finish" }
      ],
      draft: { title: "Ignored", body: "Ignored", hashtags: [], imagePrompt: "" },
      memoryObservation: "",
      finishAvailable: false,
      publishPackage: null
    }
  });

  expect(updated.currentNode?.parentId).toBe(first.currentNode!.id);
  expect(updated.currentNode?.parentOptionId).toBe("d");
  expect(updated.currentDraft?.body).toBe("Edited body");
  expect(updated.currentNode?.options.map((option) => option.label)).toEqual(["新A", "新B", "新C"]);
  expect(updated.treeNodes?.find((node) => node.id === first.currentNode!.id)?.selectedOptionId).toBe("d");
  expect(updated.nodeDrafts.find((item) => item.nodeId === first.currentNode!.id)?.draft.body).toBe("Body");
});
```

- [ ] **Step 2: Run the targeted repository test**

Run: `npm test -- src/lib/db/repository.test.ts -t "custom edit child"`

Expected: FAIL because editing still mutates the original node.

- [ ] **Step 3: Implement the repository behavior**

Add `CUSTOM_EDIT_OPTION` to `domain.ts`, add `createEditedDraftChild`, and make `updateCurrentNodeDraftAndOptions` call it with generated options. Ensure parent selection includes option `d`, the submitted draft is saved on the child, and the parent draft remains untouched.

- [ ] **Step 4: Run repository tests**

Run: `npm test -- src/lib/db/repository.test.ts`

Expected: PASS.

## Task 2: Draft Route Uses Create-Then-Options Flow

**Files:**
- Modify: `src/app/api/sessions/[sessionId]/draft/route.ts`
- Test: repository coverage from Task 1 plus app flow tests in Task 4.

- [ ] **Step 1: Change route internals**

Use `repository.createEditedDraftChild({ sessionId, nodeId, draft })`, call `generateDirectorOptions(summarizeCurrentDraftOptionsForDirector(draftState))`, then call `repository.updateNodeOptions({ sessionId, nodeId: draftState.currentNode!.id, output })`.

- [ ] **Step 2: Preserve partial state on option failure**

If option generation fails after the child draft is saved, return a successful response with `{ state: draftState, error }` so the client can focus the new node and retry missing options later.

- [ ] **Step 3: Run API-adjacent tests**

Run: `npm test -- src/components/TreeableApp.test.tsx src/lib/db/repository.test.ts`

Expected: PASS after client changes are complete.

## Task 3: LiveDraft Diff Editing

**Files:**
- Modify: `src/components/draft/LiveDraft.tsx`
- Test: `src/components/draft/LiveDraft.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests proving normal edit button text is `保存为自定义编辑`, diff edit initializes from the comparison target draft, and clicking a diff revert control changes the editor text before save.

- [ ] **Step 2: Run targeted UI tests**

Run: `npm test -- src/components/draft/LiveDraft.test.tsx`

Expected: FAIL because diff editing is not implemented and the old save label is still present.

- [ ] **Step 3: Implement editor modes**

Track `editingMode: "normal" | "diff" | null`, initialize normal edits from `content`, initialize diff edits from `displayContent`, and render a diff edit button when inline diff is showing and the draft is editable.

- [ ] **Step 4: Add small diff revert controls**

For each changed token group, render a compact button. Added-token buttons remove that text from the field; removed-token buttons insert that text near the closest unchanged neighbor.

- [ ] **Step 5: Run targeted UI tests**

Run: `npm test -- src/components/draft/LiveDraft.test.tsx`

Expected: PASS.

## Task 4: TreeableApp Save Flow

**Files:**
- Modify: `src/components/TreeableApp.tsx`
- Test: `src/components/TreeableApp.test.tsx`

- [ ] **Step 1: Write failing app test**

Update the `LiveDraft` mock so it can call `onSave`, then assert the save request body uses the currently viewed node id and `POST /draft`.

- [ ] **Step 2: Run targeted app test**

Run: `npm test -- src/components/TreeableApp.test.tsx -t "saves"`

Expected: FAIL until `saveDraft` accepts the viewed node id.

- [ ] **Step 3: Implement save flow**

Change `saveDraft` to use `activeViewNodeId`, update state from the response, show any non-fatal returned `error`, and call `ensureNodeOptions` if the returned child still has a draft but fewer than three options.

- [ ] **Step 4: Run targeted app tests**

Run: `npm test -- src/components/TreeableApp.test.tsx`

Expected: PASS.

## Task 5: Full Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

Run: `git diff --stat && git diff --check`

Expected: No whitespace errors; only intended files changed.

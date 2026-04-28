"use client";

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { createPortal } from "react-dom";
import { ImagePlus, Sparkles } from "lucide-react";
import type { Draft, PublishPackage } from "@/lib/domain";
import { resolveDraftTitle } from "@/lib/seed-draft";

export function LiveDraft({
  canCompareDrafts = false,
  comparisonDrafts = null,
  comparisonLabels = null,
  comparisonSelectionCount = 0,
  draft,
  emptyStateActions,
  headerActions,
  headerPanel,
  isEditable = false,
  isBusy,
  isComparisonMode = false,
  isLiveDiff = false,
  isLiveDiffStreaming = false,
  liveDiffStreamingField,
  mode = "current",
  onCancelComparison,
  onDismissLiveDiff,
  onRewriteSelection,
  onSave,
  onStartComparison,
  previousDraft = null
}: {
  canCompareDrafts?: boolean;
  comparisonDrafts?: { from: Draft; to: Draft } | null;
  comparisonLabels?: { from: string; to: string } | null;
  comparisonSelectionCount?: number;
  draft: Draft | null;
  emptyStateActions?: ReactNode;
  headerActions?: ReactNode;
  headerPanel?: ReactNode;
  isEditable?: boolean;
  isBusy: boolean;
  isComparisonMode?: boolean;
  isLiveDiff?: boolean;
  isLiveDiffStreaming?: boolean;
  liveDiffStreamingField?: LiveDiffStreamingField | null;
  mode?: "current" | "history";
  onCancelComparison?: () => void;
  onDismissLiveDiff?: () => void;
  onRewriteSelection?: (request: {
    draft: Draft;
    field: "body";
    instruction: string;
    selectedText: string;
    selectionEnd: number;
    selectionStart: number;
  }) => void | Promise<void>;
  onSave?: (draft: Draft) => void | Promise<void>;
  onStartComparison?: () => void;
  previousDraft?: Draft | null;
  publishPackage: PublishPackage | null;
}) {
  const content = draft;
  const initialEditableDraft = comparisonDrafts?.to ?? content;
  const [diffEditDraft, setDiffEditDraft] = useState<Draft | null>(null);
  const [selectedDiffAction, setSelectedDiffAction] = useState<SelectedDiffAction | null>(null);
  const [selectionEdit, setSelectionEdit] = useState<SelectionEditState | null>(null);
  const [selectionInstruction, setSelectionInstruction] = useState("");
  const [editingMode, setEditingMode] = useState<"normal" | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [title, setTitle] = useState(() => resolveDraftTitle(initialEditableDraft?.title, initialEditableDraft?.body));
  const [body, setBody] = useState(() => initialEditableDraft?.body ?? "");
  const [hashtags, setHashtags] = useState(() => initialEditableDraft?.hashtags.join(" ") ?? "");
  const [imagePrompt, setImagePrompt] = useState(() => initialEditableDraft?.imagePrompt ?? "");
  const baseEditableDraft = comparisonDrafts?.to ?? content;
  const hasVisibleStreamingImagePrompt = Boolean(
    content?.imagePrompt.trim() && previousDraft && content.imagePrompt !== previousDraft.imagePrompt
  );
  const inferredLiveStreamingField: LiveDiffStreamingField = hasVisibleStreamingImagePrompt
    ? "imagePrompt"
    : content && previousDraft && !sameHashtags(content.hashtags, previousDraft.hashtags)
      ? "imagePrompt"
      : "body";
  const liveStreamingField: LiveDiffStreamingField | null = isLiveDiffStreaming
    ? (liveDiffStreamingField ?? inferredLiveStreamingField)
    : null;
  const editedDraft = useMemo(
    () => ({
      title,
      body,
      hashtags: parseHashtags(hashtags),
      imagePrompt
    }),
    [body, hashtags, imagePrompt, title]
  );
  const streamingDisplayDraft = useMemo(
    () =>
      baseEditableDraft && previousDraft && isLiveDiffStreaming
        ? draftWithStreamingDisplayText(baseEditableDraft, previousDraft, liveStreamingField)
        : baseEditableDraft,
    [baseEditableDraft, isLiveDiffStreaming, liveStreamingField, previousDraft]
  );
  const isPotentialMergeDiff = Boolean(comparisonDrafts || (showDiff && content && previousDraft) || isLiveDiff);
  const canUseInlineDiffEditing = Boolean(!isLiveDiffStreaming && isPotentialMergeDiff && baseEditableDraft && isEditable && onSave);
  const canUseStreamingMergeDiff = Boolean(isLiveDiffStreaming && isPotentialMergeDiff && streamingDisplayDraft && previousDraft);
  const displayContent = canUseInlineDiffEditing
    ? editedDraft
    : canUseStreamingMergeDiff
      ? streamingDisplayDraft
      : diffEditDraft ?? baseEditableDraft;
  const displayTitle = resolveDraftTitle(displayContent?.title, displayContent?.body);
  const bodyParagraphs = splitDraftParagraphsWithOffsets(displayContent?.body);
  const isEditing = editingMode !== null && !isLiveDiff;
  const canShowParentDiff = Boolean(content && previousDraft && !isEditing);
  const canUseTreeComparison = Boolean(onStartComparison || onCancelComparison || isComparisonMode);
  const canDismissLiveDiff = Boolean(content && isLiveDiff && !isLiveDiffStreaming && onDismissLiveDiff);
  const canShowDiffControl = Boolean(
    content &&
      !isEditing &&
      (canDismissLiveDiff || (!isLiveDiff && (canCompareDrafts || canShowParentDiff || isComparisonMode)))
  );
  const draftDiff = useMemo(
    () => {
      if (comparisonDrafts && displayContent) return buildDraftDiff(comparisonDrafts.from, displayContent);
      return displayContent && previousDraft ? buildDraftDiff(previousDraft, displayContent) : null;
    },
    [comparisonDrafts, displayContent, previousDraft]
  );
  const shouldShowInlineDiff = Boolean(
    draftDiff && !isEditing && (comparisonDrafts || (showDiff && canShowParentDiff) || isLiveDiff)
  );
  const canUseSelectionRewrite = Boolean(
    content && isEditable && onRewriteSelection && !isBusy && !isComparisonMode && !isLiveDiff && !shouldShowInlineDiff
  );
  const canEditCurrentDraft = Boolean(content && isEditable && !isComparisonMode && !isLiveDiff && !showDiff);
  const isMergeDiffView = Boolean(shouldShowInlineDiff && (canUseInlineDiffEditing || canUseStreamingMergeDiff));
  const isInlineDiffEditor = Boolean(shouldShowInlineDiff && canUseInlineDiffEditing);
  const inlineDiffOriginalDraft = comparisonDrafts?.from ?? previousDraft;
  const bodyStreamingLinePosition =
    canUseStreamingMergeDiff && liveStreamingField === "body" && baseEditableDraft && previousDraft
      ? streamingCurrentLinePosition(previousDraft.body, baseEditableDraft.body)
      : null;
  const imagePromptStreamingLinePosition =
    canUseStreamingMergeDiff && liveStreamingField === "imagePrompt" && baseEditableDraft && previousDraft
      ? streamingCurrentLinePosition(previousDraft.imagePrompt || "还没有配图方向。", baseEditableDraft.imagePrompt)
      : null;
  const selectedDiffToken =
    selectedDiffAction && draftDiff ? draftDiff[selectedDiffAction.field][selectedDiffAction.tokenIndex] : null;
  const selectedDiffPopoverPosition = selectedDiffAction ? diffPopoverPosition(selectedDiffAction.anchorRect) : null;

  useEffect(() => {
    setEditingMode(null);
    setDiffEditDraft(null);
    setSelectedDiffAction(null);
    setShowDiff(false);
    setEditorFieldsFromDraft(baseEditableDraft);
  }, [baseEditableDraft?.title, baseEditableDraft?.body, baseEditableDraft?.imagePrompt, baseEditableDraft?.hashtags]);

  useEffect(() => {
    if (!selectedDiffAction) return;

    function updateDiffActionPosition() {
      setSelectedDiffAction((current) =>
        current
          ? {
              ...current,
              anchorRect: current.anchorElement.getBoundingClientRect()
            }
          : current
      );
    }

    function closeDiffAction(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".draft-diff-token--interactive")) return;
      if (target instanceof Element && target.closest(".draft-diff-token-popover")) return;
      setSelectedDiffAction(null);
    }

    document.addEventListener("scroll", updateDiffActionPosition, true);
    document.addEventListener("click", closeDiffAction);
    window.addEventListener("resize", updateDiffActionPosition);
    return () => {
      document.removeEventListener("scroll", updateDiffActionPosition, true);
      document.removeEventListener("click", closeDiffAction);
      window.removeEventListener("resize", updateDiffActionPosition);
    };
  }, [selectedDiffAction]);

  function startEditing() {
    if (!content) return;

    setEditorFieldsFromDraft(content);
    setEditingMode("normal");
  }

  function toggleDiff() {
    if (canDismissLiveDiff) {
      onDismissLiveDiff?.();
      return;
    }

    if (canUseTreeComparison) {
      if (isComparisonMode) {
        onCancelComparison?.();
        return;
      }

      onStartComparison?.();
      return;
    }

    setShowDiff((current) => !current);
  }

  async function saveDraft() {
    if (!onSave) return;

    await onSave(editedDraft);
    setEditingMode(null);
  }

  function cancelEditing() {
    setEditorFieldsFromDraft(baseEditableDraft);
    setEditingMode(null);
  }

  async function saveInlineDiffDraft() {
    if (!onSave || !baseEditableDraft) return;

    await onSave(editedDraft);
    finishInlineDiffDraft({ resetFields: false });
  }

  function exitInlineDiffDraft() {
    finishInlineDiffDraft({ resetFields: true });
  }

  function finishInlineDiffDraft({ resetFields }: { resetFields: boolean }) {
    if (resetFields) setEditorFieldsFromDraft(baseEditableDraft);
    setDiffEditDraft(null);
    setSelectedDiffAction(null);
    if (isComparisonMode) {
      onCancelComparison?.();
      return;
    }

    if (isLiveDiff && !isLiveDiffStreaming) {
      onDismissLiveDiff?.();
      return;
    }

    setShowDiff(false);
  }

  function applyInlineDiffAction(field: DiffField, tokenIndex: number) {
    if (!displayContent || !draftDiff) return;
    const tokens = draftDiff[field];
    if (field === "hashtags") {
      const nextDraft = {
        ...displayContent,
        hashtags: revertHashtagDiffToken(tokens, tokenIndex)
      };
      setDiffEditDraft(nextDraft);
      setEditorFieldsFromDraft(nextDraft);
      setSelectedDiffAction(null);
      return;
    }

    const nextValue = revertDiffToken(diffFieldValue(displayContent, field), tokens, tokenIndex);
    const nextDraft = updateDiffDraftField(displayContent, field, nextValue);
    setDiffEditDraft(nextDraft);
    setEditorFieldsFromDraft(nextDraft);
    setSelectedDiffAction(null);
  }

  function selectDiffAction(action: Omit<SelectedDiffAction, "anchorElement" | "anchorRect">, element: Element) {
    setSelectedDiffAction({
      ...action,
      anchorElement: element,
      anchorRect: element.getBoundingClientRect()
    });
  }

  function generateImage() {}

  function captureDisplayBodySelection(event: ReactMouseEvent<HTMLElement>) {
    if (!canUseSelectionRewrite || !displayContent) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const target = event.currentTarget;
    const bodyStart = Number(target.dataset.bodyStart);
    if (!range || !target.contains(range.startContainer) || !target.contains(range.endContainer)) return;
    const selectedText = range.toString();
    if (!selectedText.trim() || Number.isNaN(bodyStart)) return;
    const preRange = document.createRange();
    preRange.selectNodeContents(target);
    preRange.setEnd(range.startContainer, range.startOffset);
    const localStart = preRange.toString().length;
    const selectedLength = selectedText.length;
    openSelectionEdit({
      anchor: selectionPopoverAnchor(selection),
      draft: displayContent,
      selectedText,
      selectionStart: bodyStart + localStart,
      selectionEnd: bodyStart + localStart + selectedLength
    });
  }

  function preserveDisplayBodySelection(event: ReactMouseEvent<HTMLElement>) {
    if (!canUseSelectionRewrite) return;
    const selectedText = window.getSelection()?.toString() ?? "";
    if (selectedText.trim()) event.preventDefault();
  }

  function captureTextareaSelection(event: SyntheticEvent<HTMLTextAreaElement>) {
    if (!canUseSelectionRewrite) return;
    const target = event.currentTarget;
    if (target.selectionStart === target.selectionEnd) return;
    const selectedText = target.value.slice(target.selectionStart, target.selectionEnd);
    if (!selectedText.trim()) return;
    openSelectionEdit({
      anchor: textareaSelectionAnchor(target),
      draft: editedDraft,
      selectedText,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd
    });
  }

  function preserveTextareaSelection(event: ReactMouseEvent<HTMLTextAreaElement>) {
    if (!canUseSelectionRewrite) return;
    const target = event.currentTarget;
    if (target.selectionStart !== target.selectionEnd) event.preventDefault();
  }

  function openSelectionEdit(nextSelection: SelectionEditState) {
    setSelectionEdit(nextSelection);
    setSelectionInstruction("");
  }

  async function submitSelectionRewrite() {
    if (!selectionEdit || !onRewriteSelection || !selectionInstruction.trim()) return;
    await onRewriteSelection({
      draft: selectionEdit.draft,
      field: "body",
      instruction: selectionInstruction.trim(),
      selectedText: selectionEdit.selectedText,
      selectionStart: selectionEdit.selectionStart,
      selectionEnd: selectionEdit.selectionEnd
    });
    setSelectionEdit(null);
    setSelectionInstruction("");
  }

  function setEditorFieldsFromDraft(nextDraft: Draft | null) {
    setTitle(resolveDraftTitle(nextDraft?.title, nextDraft?.body));
    setBody(nextDraft?.body ?? "");
    setHashtags(nextDraft?.hashtags.join(" ") ?? "");
    setImagePrompt(nextDraft?.imagePrompt ?? "");
  }

  return (
    <aside className="draft-panel">
      <div className="panel-heading">
        <Sparkles size={16} />
        <span>{mode === "history" ? "历史草稿" : "实时草稿"}</span>
        <div className="draft-panel__actions">
          {headerActions}
          {canShowDiffControl ? (
            <button
              aria-pressed={isComparisonMode || showDiff || canDismissLiveDiff}
              className="draft-diff-toggle"
              disabled={isBusy}
              onClick={toggleDiff}
              type="button"
            >
              {canDismissLiveDiff || showDiff ? "关闭对比" : isComparisonMode ? "退出对比" : "对比"}
            </button>
          ) : null}
          {canEditCurrentDraft ? (
            <button className="draft-edit-button" disabled={isBusy} onClick={startEditing} type="button">
              编辑
            </button>
          ) : null}
        </div>
      </div>
      {headerPanel ? <div className="draft-panel__popover">{headerPanel}</div> : null}
      <div className="draft-panel__scroll">
        {isBusy ? <p className="updating">AI 正在生成下一版草稿...</p> : null}
        {isComparisonMode ? (
          <div className="draft-comparison-status" role="status">
            {comparisonDrafts && comparisonLabels
              ? `${comparisonLabels.from} → ${comparisonLabels.to}`
              : comparisonSelectionCount === 1
                ? "已选终点，选择起点"
                : "点选两个节点开始对比"}
          </div>
        ) : null}
        {content && isEditing ? (
          <div className="draft-editor">
            <label>
              <span>标题</span>
              <input onChange={(event) => setTitle(event.target.value)} value={title} />
            </label>
            <label>
              <span>正文</span>
              <textarea
                onChange={(event) => setBody(event.target.value)}
                onMouseDown={preserveTextareaSelection}
                onMouseUp={captureTextareaSelection}
                onSelect={captureTextareaSelection}
                rows={10}
                value={body}
              />
            </label>
            <label>
              <span>话题</span>
              <input onChange={(event) => setHashtags(event.target.value)} value={hashtags} />
            </label>
            <label>
              <span>配图提示</span>
              <textarea onChange={(event) => setImagePrompt(event.target.value)} rows={4} value={imagePrompt} />
            </label>
            <div className="draft-editor__actions">
              <button className="secondary-button" disabled={isBusy} onClick={cancelEditing} type="button">
                退出草稿
              </button>
              <button className="start-button" disabled={isBusy} onClick={() => void saveDraft()} type="button">
                保存草稿
              </button>
            </div>
          </div>
        ) : content ? (
          <div className="draft-content">
            {isMergeDiffView && draftDiff ? (
              <>
                <h2>
                  <DraftDiffMergeField
                    className="draft-cm-diff-field--title"
                    disabled={isBusy || canUseStreamingMergeDiff}
                    label="标题"
                    onChange={canUseStreamingMergeDiff ? undefined : setTitle}
                    original={resolveDraftTitle(inlineDiffOriginalDraft?.title, inlineDiffOriginalDraft?.body)}
                    rows={1}
                    value={resolveDraftTitle(displayContent?.title, displayContent?.body)}
                  />
                </h2>
                <div className="draft-body">
                  <DraftDiffMergeField
                    disabled={isBusy || canUseStreamingMergeDiff}
                    label="正文"
                    onChange={canUseStreamingMergeDiff ? undefined : setBody}
                    original={inlineDiffOriginalDraft?.body ?? ""}
                    rows={10}
                    streamingLinePosition={bodyStreamingLinePosition}
                    value={displayContent?.body ?? ""}
                  />
                </div>
                <div className="tag-row">
                  <DiffTokens
                    field="hashtags"
                    isInteractive={false}
                    onSelect={selectDiffAction}
                    selectedAction={selectedDiffAction}
                    tokens={draftDiff.hashtags}
                  />
                </div>
                <section className="image-prompt">
                  <div className="image-prompt__heading">
                    <h3>配图提示</h3>
                    <button className="image-prompt__generate-button" disabled={isBusy} onClick={generateImage} type="button">
                      <ImagePlus aria-hidden="true" size={14} />
                      <span>生成图片</span>
                    </button>
                  </div>
                  <DraftDiffMergeField
                    disabled={isBusy || canUseStreamingMergeDiff}
                    label="配图提示"
                    onChange={canUseStreamingMergeDiff ? undefined : setImagePrompt}
                    original={inlineDiffOriginalDraft?.imagePrompt ?? ""}
                    rows={4}
                    streamingLinePosition={imagePromptStreamingLinePosition}
                    value={displayContent?.imagePrompt ?? ""}
                  />
                </section>
                {isInlineDiffEditor ? (
                  <div className="draft-diff-inline-actions">
                    <button className="secondary-button" disabled={isBusy} onClick={exitInlineDiffDraft} type="button">
                      退出草稿
                    </button>
                    <button className="start-button" disabled={isBusy} onClick={() => void saveInlineDiffDraft()} type="button">
                      保存草稿
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <h2>
                  {shouldShowInlineDiff && draftDiff ? (
                    <DiffTokens
                      field="title"
                      isInteractive={canUseInlineDiffEditing}
                      onSelect={selectDiffAction}
                      selectedAction={selectedDiffAction}
                      tokens={draftDiff.title}
                    />
                  ) : (
                    displayTitle
                  )}
                </h2>
                <div className="draft-body">
                  {shouldShowInlineDiff && draftDiff ? (
                    <p className="draft-inline-diff">
                      <DiffTokens
                        field="body"
                        isInteractive={canUseInlineDiffEditing}
                        onSelect={selectDiffAction}
                        selectedAction={selectedDiffAction}
                        tokens={draftDiff.body}
                      />
                    </p>
                  ) : (
                    bodyParagraphs.map((paragraph) => (
                      <p
                        data-body-end={paragraph.end}
                        data-body-start={paragraph.start}
                        key={`${paragraph.start}-${paragraph.text}`}
                        onMouseDown={preserveDisplayBodySelection}
                        onMouseUp={captureDisplayBodySelection}
                      >
                        {paragraph.text}
                      </p>
                    ))
                  )}
                </div>
                <div className="tag-row">
                  {shouldShowInlineDiff && draftDiff ? (
                    <DiffTokens
                      field="hashtags"
                      isInteractive={canUseInlineDiffEditing}
                      onSelect={selectDiffAction}
                      selectedAction={selectedDiffAction}
                      tokens={draftDiff.hashtags}
                    />
                  ) : (
                    (displayContent?.hashtags ?? []).map((tag) => <span key={tag}>{tag}</span>)
                  )}
                </div>
                <section className="image-prompt">
                  <div className="image-prompt__heading">
                    <h3>配图提示</h3>
                    <button className="image-prompt__generate-button" disabled={isBusy} onClick={generateImage} type="button">
                      <ImagePlus aria-hidden="true" size={14} />
                      <span>生成图片</span>
                    </button>
                  </div>
                  <p className={shouldShowInlineDiff ? "draft-inline-diff" : undefined}>
                    {shouldShowInlineDiff && draftDiff ? (
                      <DiffTokens
                        field="imagePrompt"
                        isInteractive={canUseInlineDiffEditing}
                        onSelect={selectDiffAction}
                        selectedAction={selectedDiffAction}
                        tokens={draftDiff.imagePrompt}
                      />
                    ) : (
                      displayContent?.imagePrompt || "还没有配图方向。"
                    )}
                  </p>
                </section>
              </>
            )}
            {selectedDiffAction && selectedDiffToken && selectedDiffPopoverPosition && typeof document !== "undefined"
              ? createPortal(
                  <div
                    className="draft-diff-token-popover"
                    style={{
                      left: selectedDiffPopoverPosition.left,
                      top: selectedDiffPopoverPosition.top
                    }}
                  >
                    <button
                      className="draft-diff-token__action"
                      onClick={() => applyInlineDiffAction(selectedDiffAction.field, selectedDiffAction.tokenIndex)}
                      type="button"
                    >
                      {actionLabelForDiffToken(selectedDiffToken)}：{previewDiffValue(selectedDiffToken.value)}
                    </button>
                    <button
                      aria-label="关闭差异操作"
                      className="draft-diff-token__close"
                      onClick={() => setSelectedDiffAction(null)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>,
                  document.body
                )
              : null}
          </div>
        ) : (
          <div className="draft-empty-state">
            <p className="empty-copy">开始创作后，草稿会在这里同步更新。</p>
            {emptyStateActions ? <div className="draft-empty-state__actions">{emptyStateActions}</div> : null}
          </div>
        )}
      </div>
      {selectionEdit ? (
        <div className="draft-selection-edit" style={{ left: selectionEdit.anchor.left, top: selectionEdit.anchor.top }}>
          <p className="draft-selection-edit__preview">{previewSelectionText(selectionEdit.selectedText)}</p>
          <label>
            <span>修改要求</span>
            <textarea
              autoFocus
              onChange={(event) => setSelectionInstruction(event.target.value)}
              rows={3}
              value={selectionInstruction}
            />
          </label>
          <div className="draft-selection-edit__actions">
            <button className="secondary-button" onClick={() => setSelectionEdit(null)} type="button">
              关闭
            </button>
            <button
              className="start-button"
              disabled={!selectionInstruction.trim()}
              onClick={() => void submitSelectionRewrite()}
              type="button"
            >
              发送修改
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function splitDraftParagraphsWithOffsets(body?: string) {
  const source = body ?? "";
  const matches = Array.from(source.matchAll(/[^\n]+/g));
  const paragraphs = matches
    .map((match) => {
      const rawText = match[0];
      const leadingWhitespace = rawText.match(/^\s*/)?.[0].length ?? 0;
      const text = rawText.trim();
      return {
        end: (match.index ?? 0) + leadingWhitespace + text.length,
        start: (match.index ?? 0) + leadingWhitespace,
        text
      };
    })
    .filter((paragraph) => paragraph.text.length > 0);

  return paragraphs.length ? paragraphs : [{ start: 0, end: 0, text: "第一次选择后，草稿会在这里更新。" }];
}

function selectionPopoverAnchor(selection: Selection | null) {
  const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  return {
    left: Math.max(12, rect?.left ?? 24),
    top: Math.max(12, (rect?.bottom ?? 24) + 8)
  };
}

function textareaSelectionAnchor(textarea: HTMLTextAreaElement) {
  const rect = textarea.getBoundingClientRect();
  return { left: rect.left + 12, top: rect.top + 36 };
}

function previewSelectionText(value: string) {
  const preview = value.replace(/\s+/g, " ").trim();
  return Array.from(preview).slice(0, 48).join("");
}

function parseHashtags(value: string) {
  return value
    .split(/[\s,，]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

type DiffToken = {
  type: "same" | "added" | "removed";
  value: string;
};

type DiffField = "title" | "body" | "hashtags" | "imagePrompt";
type LiveDiffStreamingField = Extract<DiffField, "body" | "imagePrompt">;

type SelectionEditState = {
  anchor: { left: number; top: number };
  draft: Draft;
  selectedText: string;
  selectionEnd: number;
  selectionStart: number;
};

type SelectedDiffAction = {
  anchorElement: Element;
  anchorRect: DiffActionAnchor;
  field: DiffField;
  tokenIndex: number;
};

type DiffActionAnchor = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

function DiffTokens({
  field,
  isInteractive = false,
  onSelect,
  selectedAction,
  tokens
}: {
  field?: DiffField;
  isInteractive?: boolean;
  onSelect?: (action: Omit<SelectedDiffAction, "anchorElement" | "anchorRect">, element: Element) => void;
  selectedAction?: SelectedDiffAction | null;
  tokens: DiffToken[];
}) {
  return (
    <>
      {tokens.map((token, index) => {
        const canSelect = Boolean(isInteractive && field && onSelect && token.type !== "same" && token.value.length > 0);
        const isSelected = Boolean(selectedAction && selectedAction.field === field && selectedAction.tokenIndex === index);
        const preview = previewDiffValue(token.value);
        const className = `draft-diff-token draft-diff-token--${token.type}${
          canSelect ? " draft-diff-token--interactive" : ""
        }${isSelected ? " draft-diff-token--selected" : ""}`;
        if (canSelect && field) {
          return (
            <span
              aria-label={`选择差异：${preview}`}
              className={className}
              key={`${index}-${token.type}-${token.value}`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect?.({ field, tokenIndex: index }, event.currentTarget);
                }
              }}
              onClick={(event) => onSelect?.({ field, tokenIndex: index }, event.currentTarget)}
              role="button"
              tabIndex={0}
            >
              {token.value}
            </span>
          );
        }

        return (
          <span className={className} key={`${index}-${token.type}-${token.value}`}>
            {token.value}
          </span>
        );
      })}
    </>
  );
}

function DraftDiffMergeField({
  className,
  disabled = false,
  label,
  onChange,
  original,
  rows,
  streamingLinePosition = null,
  value
}: {
  className?: string;
  disabled?: boolean;
  label: string;
  onChange?: (value: string) => void;
  original: string;
  rows: number;
  streamingLinePosition?: number | null;
  value: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const streamingLinePositionRef = useRef(streamingLinePosition);
  const originalRef = useRef(original);
  const stableMergeOriginalRef = useRef(mergeViewOriginalText(original, value));
  if (originalRef.current !== original) {
    originalRef.current = original;
    stableMergeOriginalRef.current = mergeViewOriginalText(original, value);
  }
  const liveMergeOriginal = useMemo(() => mergeViewOriginalText(original, value), [original, value]);
  const mergeOriginal = disabled ? liveMergeOriginal : stableMergeOriginalRef.current;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    streamingLinePositionRef.current = streamingLinePosition;
    viewRef.current?.dispatch({});
  }, [streamingLinePosition]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": label
          }),
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
          unifiedMergeView({
            allowInlineDiffs: rows <= 1,
            diffConfig: draftMergeDiffConfig,
            gutter: false,
            highlightChanges: true,
            mergeControls: false,
            original: mergeOriginal
          }),
          streamingCurrentLineExtension(() => streamingLinePositionRef.current),
          draftMergeEditorTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || !onChangeRef.current) return;
            onChangeRef.current(update.state.doc.toString());
          })
        ]
      })
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [disabled, label, mergeOriginal]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (currentValue === value) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    });
  }, [value]);

  return (
    <section
      className={`draft-cm-diff-field${className ? ` ${className}` : ""}`}
      style={{ "--draft-cm-min-lines": rows } as CSSProperties}
    >
      <span className="draft-cm-diff-field__label">{label}</span>
      <div className="draft-cm-diff-field__editor" data-diff-editor-label={label} ref={containerRef} />
    </section>
  );
}

const draftMergeDiffConfig = { scanLimit: 10000 };

function streamingCurrentLineExtension(getPosition: () => number | null) {
  return EditorView.decorations.of((view) => {
    const position = getPosition();
    if (position === null || view.state.doc.length === 0) return Decoration.none;

    const line = view.state.doc.lineAt(Math.min(Math.max(position, 0), view.state.doc.length));
    return Decoration.set([Decoration.line({ class: "cm-stream-current-line" }).range(line.from)]);
  });
}

const draftMergeEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "#fbfcfc",
    border: "1px solid rgba(148, 163, 184, 0.42)",
    borderRadius: "8px",
    color: "#102033",
    fontSize: "0.95rem"
  },
  "&.cm-focused": {
    borderColor: "rgba(37, 99, 235, 0.54)",
    outline: "none",
    boxShadow: "0 0 0 3px rgba(37, 99, 235, 0.1)"
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.6",
    minHeight: "calc(var(--draft-cm-min-lines, 4) * 1.6em + 20px)"
  },
  ".cm-content": {
    padding: "10px 11px",
    caretColor: "#0f172a"
  },
  ".cm-line": {
    padding: "0"
  },
  ".cm-stream-current-line": {
    backgroundColor: "rgba(14, 165, 233, 0.16)",
    boxShadow: "inset 3px 0 0 rgba(2, 132, 199, 0.72)"
  },
  ".cm-stream-current-line .cm-changedText": {
    backgroundColor: "rgba(125, 211, 252, 0.82)",
    color: "#075985"
  },
  ".cm-deletedChunk": {
    backgroundColor: "rgba(254, 202, 202, 0.35)",
    border: "0",
    color: "#991b1b",
    margin: "2px 0"
  },
  ".cm-deletedLine": {
    backgroundColor: "rgba(254, 202, 202, 0.78)",
    borderRadius: "4px",
    color: "#991b1b",
    textDecoration: "line-through"
  },
  ".cm-insertedLine, .cm-changedLine": {
    backgroundColor: "rgba(187, 247, 208, 0.44)"
  },
  ".cm-changedText": {
    backgroundColor: "rgba(187, 247, 208, 0.82)",
    borderRadius: "4px",
    color: "#166534"
  },
  ".cm-deletedText": {
    backgroundColor: "rgba(254, 202, 202, 0.82)",
    borderRadius: "4px",
    color: "#991b1b",
    textDecoration: "line-through"
  }
});

function mergeViewOriginalText(original: string, value: string) {
  if (!original || original.endsWith("\n") || !value.startsWith(original)) return original;

  const appendedText = value.slice(original.length);
  const leadingParagraphBreak = appendedText.match(/^(?:\r?\n)+/)?.[0];
  return leadingParagraphBreak ? `${original}${leadingParagraphBreak}` : original;
}

function buildDraftDiff(previousDraft: Draft, currentDraft: Draft) {
  const previousImagePrompt = previousDraft.imagePrompt || "还没有配图方向。";
  const currentImagePrompt = currentDraft.imagePrompt || "还没有配图方向。";

  return {
    title: diffText(resolveDraftTitle(previousDraft.title, previousDraft.body), resolveDraftTitle(currentDraft.title, currentDraft.body)),
    body: diffText(previousDraft.body, currentDraft.body),
    hashtags: diffHashtags(previousDraft.hashtags, currentDraft.hashtags),
    imagePrompt: diffText(previousImagePrompt, currentImagePrompt)
  };
}

function draftWithStreamingDisplayText(currentDraft: Draft, previousDraft: Draft, streamingField: LiveDiffStreamingField | null): Draft {
  if (streamingField === "body") {
    return {
      ...currentDraft,
      body: streamingDisplayText(previousDraft.body, currentDraft.body)
    };
  }

  if (streamingField === "imagePrompt") {
    const previousImagePrompt = previousDraft.imagePrompt || "还没有配图方向。";
    const currentImagePrompt = currentDraft.imagePrompt || previousImagePrompt;
    return {
      ...currentDraft,
      imagePrompt: streamingDisplayText(previousImagePrompt, currentImagePrompt)
    };
  }

  return currentDraft;
}

function streamingDisplayText(previousText: string, currentPartialText: string) {
  if (!currentPartialText || currentPartialText === previousText) return previousText;

  const prefixLength = commonPrefixLength(previousText, currentPartialText);
  const coveredPreviousLength = Math.min(previousText.length, Math.max(prefixLength, currentPartialText.length));
  return `${previousText.slice(0, prefixLength)}${currentPartialText.slice(prefixLength)}${previousText.slice(coveredPreviousLength)}`;
}

function streamingCurrentLinePosition(previousText: string, currentPartialText: string) {
  if (!currentPartialText || currentPartialText === previousText) return null;
  return currentPartialText.length;
}

function revertDiffToken(value: string, tokens: DiffToken[], tokenIndex: number) {
  const token = tokens[tokenIndex];
  if (!token || token.type === "same" || !token.value) return value;

  if (token.type === "added") {
    return removeFirst(value, token.value);
  }

  const nextSame = tokens.slice(tokenIndex + 1).find((item) => item.type === "same" && item.value.length > 0);
  if (nextSame) {
    const nextIndex = value.indexOf(nextSame.value);
    if (nextIndex >= 0) {
      return `${value.slice(0, nextIndex)}${token.value}${value.slice(nextIndex)}`;
    }
  }

  const previousSame = tokens
    .slice(0, tokenIndex)
    .reverse()
    .find((item) => item.type === "same" && item.value.length > 0);
  if (previousSame) {
    const previousIndex = value.indexOf(previousSame.value);
    if (previousIndex >= 0) {
      const insertAt = previousIndex + previousSame.value.length;
      return `${value.slice(0, insertAt)}${token.value}${value.slice(insertAt)}`;
    }
  }

  return `${value}${token.value}`;
}

function revertHashtagDiffToken(tokens: DiffToken[], tokenIndex: number) {
  return tokens.flatMap((token, index) => {
    if (!token.value || token.value === "空") return [];
    if (token.type === "same") return [token.value];
    if (token.type === "added") return index === tokenIndex ? [] : [token.value];
    return index === tokenIndex ? [token.value] : [];
  });
}

function diffFieldValue(draft: Draft, field: DiffField) {
  if (field === "title") return resolveDraftTitle(draft.title, draft.body);
  if (field === "hashtags") return draft.hashtags.join(" ");
  return draft[field];
}

function updateDiffDraftField(draft: Draft, field: DiffField, value: string): Draft {
  if (field === "hashtags") {
    return {
      ...draft,
      hashtags: value
        .split(/[\s,，]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    };
  }

  return {
    ...draft,
    [field]: value
  };
}

function actionLabelForDiffToken(token: DiffToken) {
  return token.type === "added" ? "撤销新增" : "撤销删除";
}

function diffPopoverPosition(anchor: DiffActionAnchor) {
  if (typeof window === "undefined") return { left: anchor.left, top: anchor.bottom + 6 };

  const popoverWidth = 260;
  const popoverHeight = 42;
  const margin = 10;
  const gap = 6;
  const maxLeft = Math.max(margin, window.innerWidth - popoverWidth - margin);
  const left = Math.max(margin, Math.min(anchor.left, maxLeft));
  const bottomTop = anchor.bottom + gap;
  const top =
    bottomTop + popoverHeight > window.innerHeight - margin
      ? Math.max(margin, anchor.top - popoverHeight - gap)
      : bottomTop;

  return { left, top };
}

function removeFirst(value: string, tokenValue: string) {
  const index = value.indexOf(tokenValue);
  if (index < 0) return value;
  return `${value.slice(0, index)}${value.slice(index + tokenValue.length)}`;
}

function previewDiffValue(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const preview = normalized || "空白";
  return Array.from(preview).slice(0, 12).join("");
}

function diffText(previousText: string, currentText: string): DiffToken[] {
  if (previousText === currentText) return [{ type: "same", value: previousText || "空" }];

  return diffSegments(segmentText(previousText), segmentText(currentText), true);
}

function diffHashtags(previousTags: string[], currentTags: string[]): DiffToken[] {
  if (previousTags.length === 0 && currentTags.length === 0) return [{ type: "same", value: "空" }];
  return diffSegments(previousTags, currentTags, false);
}

function sameHashtags(previousTags: string[], currentTags: string[]) {
  return previousTags.length === currentTags.length && previousTags.every((tag, index) => tag === currentTags[index]);
}

function diffSegments(previousSegments: string[], currentSegments: string[], mergeAdjacent: boolean): DiffToken[] {
  const lengths = Array.from({ length: previousSegments.length + 1 }, () => Array(currentSegments.length + 1).fill(0) as number[]);

  for (let previousIndex = previousSegments.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let currentIndex = currentSegments.length - 1; currentIndex >= 0; currentIndex -= 1) {
      lengths[previousIndex][currentIndex] =
        previousSegments[previousIndex] === currentSegments[currentIndex]
          ? lengths[previousIndex + 1][currentIndex + 1] + 1
          : Math.max(lengths[previousIndex + 1][currentIndex], lengths[previousIndex][currentIndex + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let previousIndex = 0;
  let currentIndex = 0;

  while (previousIndex < previousSegments.length && currentIndex < currentSegments.length) {
    if (previousSegments[previousIndex] === currentSegments[currentIndex]) {
      pushDiffToken(tokens, "same", previousSegments[previousIndex], mergeAdjacent);
      previousIndex += 1;
      currentIndex += 1;
    } else if (lengths[previousIndex + 1][currentIndex] >= lengths[previousIndex][currentIndex + 1]) {
      pushDiffToken(tokens, "removed", previousSegments[previousIndex], mergeAdjacent);
      previousIndex += 1;
    } else {
      pushDiffToken(tokens, "added", currentSegments[currentIndex], mergeAdjacent);
      currentIndex += 1;
    }
  }

  while (previousIndex < previousSegments.length) {
    pushDiffToken(tokens, "removed", previousSegments[previousIndex], mergeAdjacent);
    previousIndex += 1;
  }

  while (currentIndex < currentSegments.length) {
    pushDiffToken(tokens, "added", currentSegments[currentIndex], mergeAdjacent);
    currentIndex += 1;
  }

  return tokens;
}

function pushDiffToken(tokens: DiffToken[], type: DiffToken["type"], value: string, mergeAdjacent = true) {
  if (!value) return;

  const lastToken = tokens[tokens.length - 1];
  if (mergeAdjacent && lastToken?.type === type) {
    lastToken.value += value;
    return;
  }

  tokens.push({ type, value });
}

function commonPrefixLength(left: string, right: string) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function segmentText(text: string) {
  if (!text) return [];

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }

  return Array.from(text);
}

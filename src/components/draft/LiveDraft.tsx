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
import { Copy, ImagePlus, Send, Sparkles, X } from "lucide-react";
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
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("actions");
  const [selectionInstruction, setSelectionInstruction] = useState("");
  const [isSelectionRewritePending, setIsSelectionRewritePending] = useState(false);
  const selectionRewritePendingRef = useRef(false);
  const [isGeneratedDiffEditing, setIsGeneratedDiffEditing] = useState(false);
  const [editingMode, setEditingMode] = useState<"normal" | null>(null);
  const [isPublishPanelOpen, setIsPublishPanelOpen] = useState(false);
  const [activePublishPlatform, setActivePublishPlatform] = useState<PublishPlatform>("weibo");
  const [publishTexts, setPublishTexts] = useState<PublishTextByPlatform>({
    weibo: "",
    xiaohongshu: "",
    moments: ""
  });
  const [publishXiaohongshuTitle, setPublishXiaohongshuTitle] = useState("");
  const [publishImagePrompt, setPublishImagePrompt] = useState("");
  const [copiedPublishAction, setCopiedPublishAction] = useState<PublishCopyAction | null>(null);
  const [publishCopyError, setPublishCopyError] = useState("");
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
  const canEditGeneratedDiffReview = Boolean(
    isLiveDiff && !isLiveDiffStreaming && isPotentialMergeDiff && baseEditableDraft && previousDraft && isEditable && onSave
  );
  const canUseGeneratedDiffReadOnlyMerge = Boolean(canEditGeneratedDiffReview && !isGeneratedDiffEditing);
  const canUseInlineDiffEditing = Boolean(
    !isLiveDiffStreaming &&
      isPotentialMergeDiff &&
      baseEditableDraft &&
      isEditable &&
      onSave &&
      (!isLiveDiff || isGeneratedDiffEditing)
  );
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
  const canUseSelectionRewrite = Boolean(content && onRewriteSelection);
  const canEditCurrentDraft = Boolean(content && isEditable && !isComparisonMode && !isLiveDiff && !showDiff);
  const isMergeDiffView = Boolean(
    shouldShowInlineDiff && (canUseInlineDiffEditing || canUseStreamingMergeDiff || canUseGeneratedDiffReadOnlyMerge)
  );
  const isInlineDiffEditor = Boolean(shouldShowInlineDiff && canUseInlineDiffEditing);
  const isReadOnlyMergeDiff = Boolean(canUseStreamingMergeDiff || canUseGeneratedDiffReadOnlyMerge);
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
    setIsGeneratedDiffEditing(false);
    setIsPublishPanelOpen(false);
    setCopiedPublishAction(null);
    setPublishCopyError("");
    setPublishFieldsFromDraft(baseEditableDraft);
    closeSelectionEdit();
    setShowDiff(false);
    setEditorFieldsFromDraft(baseEditableDraft);
  }, [baseEditableDraft?.title, baseEditableDraft?.body, baseEditableDraft?.imagePrompt, baseEditableDraft?.hashtags]);

  useEffect(() => {
    if (isLiveDiff && !isLiveDiffStreaming) return;
    setIsGeneratedDiffEditing(false);
  }, [isLiveDiff, isLiveDiffStreaming]);

  useEffect(() => {
    if (canUseSelectionRewrite) return;
    closeSelectionEdit();
  }, [canUseSelectionRewrite]);

  useEffect(() => {
    if (!selectionEdit) return;
    closeSelectionEdit();
  }, [editingMode, isComparisonMode, isGeneratedDiffEditing, showDiff]);

  useEffect(() => {
    if (!isEditing || !selectionEdit) return;
    closeSelectionEdit();
  }, [title, body, hashtags, imagePrompt]);

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

    setIsPublishPanelOpen(false);
    setEditorFieldsFromDraft(content);
    setEditingMode("normal");
  }

  function toggleDiff() {
    setIsPublishPanelOpen(false);

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

  function startGeneratedDiffEditing() {
    if (!baseEditableDraft) return;

    setEditorFieldsFromDraft(baseEditableDraft);
    setDiffEditDraft(null);
    setSelectedDiffAction(null);
    setIsGeneratedDiffEditing(true);
  }

  function finishInlineDiffDraft({ resetFields }: { resetFields: boolean }) {
    if (resetFields) setEditorFieldsFromDraft(baseEditableDraft);
    setDiffEditDraft(null);
    setSelectedDiffAction(null);
    setIsGeneratedDiffEditing(false);
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
    if (!range || !target.contains(range.startContainer) || !target.contains(range.endContainer)) return;
    const selectedRange = bodyOffsetsForDisplayRange(target, range);
    if (!selectedRange) return;
    const selectedText = displayContent.body.slice(selectedRange.start, selectedRange.end);
    if (!selectedText.trim()) return;
    openSelectionEdit({
      anchors: selectionPopoverAnchors(selection),
      draft: displayContent,
      selectedText,
      selectionStart: selectedRange.start,
      selectionEnd: selectedRange.end
    });
  }

  function preserveDisplayBodySelection(event: ReactMouseEvent<HTMLElement>) {
    if (!canUseSelectionRewrite) return;
    if (selectionEdit) {
      closeSelectionEdit();
      window.getSelection()?.removeAllRanges();
      return;
    }
  }

  function captureTextareaSelection(event: SyntheticEvent<HTMLTextAreaElement>) {
    if (!canUseSelectionRewrite) return;
    const target = event.currentTarget;
    if (target.selectionStart === target.selectionEnd) return;
    const selectedText = target.value.slice(target.selectionStart, target.selectionEnd);
    if (!selectedText.trim()) return;
    openSelectionEdit({
      anchors: textareaSelectionAnchors(target),
      draft: editedDraft,
      selectedText,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd
    });
  }

  function captureMergeBodySelection(selection: CapturedTextSelection) {
    if (!canUseSelectionRewrite || !displayContent) return;
    openSelectionEdit({
      ...selection,
      draft: displayContent
    });
  }

  function preserveTextareaSelection(event: ReactMouseEvent<HTMLTextAreaElement>) {
    if (!canUseSelectionRewrite) return;
    if (selectionEdit) {
      closeSelectionEdit();
      event.currentTarget.setSelectionRange(event.currentTarget.selectionStart, event.currentTarget.selectionStart);
      return;
    }

  }

  function openSelectionEdit(nextSelection: SelectionEditState) {
    setSelectionEdit(nextSelection);
    setSelectionMode("actions");
    setSelectionInstruction("");
  }

  function closeSelectionEdit() {
    setSelectionEdit(null);
    setSelectionMode("actions");
    setSelectionInstruction("");
  }

  async function copySelectionText() {
    if (!selectionEdit) return;

    try {
      await copyTextToClipboard(selectionEdit.selectedText);
    } catch {
      // Clipboard permission can be denied in browser automation or locked-down contexts.
    } finally {
      closeSelectionEdit();
    }
  }

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

  async function submitSelectionRewrite() {
    if (
      selectionRewritePendingRef.current ||
      !canUseSelectionRewrite ||
      !selectionEdit ||
      !onRewriteSelection ||
      !selectionInstruction.trim()
    ) {
      return;
    }
    const request = {
      draft: selectionEdit.draft,
      field: "body" as const,
      instruction: selectionInstruction.trim(),
      selectedText: selectionEdit.selectedText,
      selectionStart: selectionEdit.selectionStart,
      selectionEnd: selectionEdit.selectionEnd
    };
    selectionRewritePendingRef.current = true;
    setIsSelectionRewritePending(true);
    closeSelectionEdit();
    try {
      await onRewriteSelection(request);
    } finally {
      selectionRewritePendingRef.current = false;
      setIsSelectionRewritePending(false);
    }
  }

  function setEditorFieldsFromDraft(nextDraft: Draft | null) {
    setTitle(resolveDraftTitle(nextDraft?.title, nextDraft?.body));
    setBody(nextDraft?.body ?? "");
    setHashtags(nextDraft?.hashtags.join(" ") ?? "");
    setImagePrompt(nextDraft?.imagePrompt ?? "");
  }

  function setPublishFieldsFromDraft(nextDraft: Draft | null) {
    setPublishTexts({
      weibo: nextDraft ? formatPublishText(nextDraft, "weibo") : "",
      xiaohongshu: nextDraft ? formatPublishText(nextDraft, "xiaohongshu") : "",
      moments: nextDraft ? formatPublishText(nextDraft, "moments") : ""
    });
    setPublishXiaohongshuTitle(nextDraft ? resolveDraftTitle(nextDraft.title, nextDraft.body).trim() : "");
    setPublishImagePrompt(nextDraft?.imagePrompt.trim() ?? "");
  }

  return (
    <aside className="draft-panel">
      <div className="panel-heading">
        <Sparkles size={16} />
        <span>{mode === "history" ? "历史草稿" : "实时草稿"}</span>
        <div className="draft-panel__actions">
          {headerActions}
          {content && !isComparisonMode ? (
            <button
              aria-expanded={isPublishPanelOpen}
              className="draft-publish-button"
              disabled={isBusy}
              onClick={() => {
                setPublishCopyError("");
                setCopiedPublishAction(null);
                if (!isPublishPanelOpen) setPublishFieldsFromDraft(content);
                setIsPublishPanelOpen((open) => !open);
              }}
              type="button"
            >
              <Send aria-hidden="true" size={13} />
              <span>发布</span>
            </button>
          ) : null}
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
            {(["weibo", "xiaohongshu", "moments"] as const).map((platform) => (
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
          <section className="draft-publish-image-prompt">
            <div className="draft-publish-image-prompt__meta">
              <span>配图提示</span>
              {publishImagePrompt.trim() ? (
                <button onClick={() => void copyPublishText("imagePrompt")} type="button">
                  <Copy aria-hidden="true" size={13} />
                  <span>{copiedPublishAction === "imagePrompt" ? "已复制" : "复制配图提示"}</span>
                </button>
              ) : null}
            </div>
            <textarea
              aria-label="配图提示"
              onChange={(event) => {
                setPublishImagePrompt(event.target.value);
                setCopiedPublishAction(null);
              }}
              placeholder="还没有配图提示。"
              rows={3}
              value={publishImagePrompt}
            />
          </section>
          <div className="draft-publish-actions">
            {[publishPrimaryActionFor(activePublishPlatform), ...secondaryPublishActionsFor(content, activePublishPlatform)].map(
              (action) => (
                <button
                  className={
                    action === publishPrimaryActionFor(activePublishPlatform) ? "draft-publish-actions__primary" : undefined
                  }
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
          <div className="draft-publish-checks" aria-label={`${publishPlatformLabel(activePublishPlatform)}发布检查`}>
            {buildPublishChecks(
              content,
              activePublishPlatform,
              publishTexts[activePublishPlatform],
              publishImagePrompt,
              publishXiaohongshuTitle
            ).map((check) => (
              <p className={`draft-publish-check draft-publish-check--${check.tone}`} key={check.text}>
                <span aria-hidden="true">{check.tone === "ok" ? "✓" : check.tone === "warn" ? "!" : "•"}</span>
                <span>{check.text}</span>
              </p>
            ))}
          </div>
        </aside>
      ) : null}
      <div className="draft-panel__scroll">
        {isBusy ? (
          <div aria-label="草稿生成状态" aria-live="polite" className="draft-streaming-status" role="status">
            <div className="draft-streaming-status__content">
              <span aria-hidden="true" className="draft-streaming-status__pulse" />
              <span className="draft-streaming-status__title">AI 正在生成下一版草稿...</span>
              <span aria-hidden="true" className="draft-streaming-status__activity">
                <span />
                <span />
                <span />
              </span>
            </div>
            <div aria-hidden="true" className="draft-streaming-status__bar" />
          </div>
        ) : null}
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
                    disabled={isBusy || isReadOnlyMergeDiff}
                    label="标题"
                    onChange={isReadOnlyMergeDiff ? undefined : setTitle}
                    original={resolveDraftTitle(inlineDiffOriginalDraft?.title, inlineDiffOriginalDraft?.body)}
                    rows={1}
                    value={resolveDraftTitle(displayContent?.title, displayContent?.body)}
                  />
                </h2>
                <div className="draft-body">
                  <DraftDiffMergeField
                    disabled={isBusy || isReadOnlyMergeDiff}
                    label="正文"
                    onChange={isReadOnlyMergeDiff ? undefined : setBody}
                    onSelectText={canUseSelectionRewrite ? captureMergeBodySelection : undefined}
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
                    disabled={isBusy || isReadOnlyMergeDiff}
                    label="配图提示"
                    onChange={isReadOnlyMergeDiff ? undefined : setImagePrompt}
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
                ) : canUseGeneratedDiffReadOnlyMerge ? (
                  <div className="draft-diff-inline-actions">
                    <button className="start-button" disabled={isBusy} onClick={startGeneratedDiffEditing} type="button">
                      编辑
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
                <div
                  className="draft-body"
                  onMouseDown={preserveDisplayBodySelection}
                  onMouseUp={captureDisplayBodySelection}
                >
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
      {selectionEdit && typeof document !== "undefined"
        ? createPortal(
            selectionMode === "actions" ? (
              <div
                aria-label="选中文本操作"
                className="draft-selection-actions"
                role="toolbar"
                style={{ left: selectionEdit.anchors.actions.left, top: selectionEdit.anchors.actions.top }}
              >
                <button onClick={() => setSelectionMode("edit")} type="button">
                  引用
                </button>
                <button onClick={() => void copySelectionText()} type="button">
                  复制
                </button>
              </div>
            ) : (
              <div
                aria-label="引用选中文本修改"
                className="draft-selection-edit"
                role="dialog"
                style={{ left: selectionEdit.anchors.editor.left, top: selectionEdit.anchors.editor.top }}
              >
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
                  <button className="secondary-button" onClick={closeSelectionEdit} type="button">
                    关闭
                  </button>
                  <button
                    className="start-button"
                    disabled={!selectionInstruction.trim() || isSelectionRewritePending || isBusy}
                    onClick={() => void submitSelectionRewrite()}
                    type="button"
                  >
                    发送修改
                  </button>
                </div>
              </div>
            ),
            document.body
          )
        : null}
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

function bodyOffsetsForDisplayRange(container: HTMLElement, range: Range) {
  const start = bodyOffsetForDisplayBoundary(container, range.startContainer, range.startOffset);
  const end = bodyOffsetForDisplayBoundary(container, range.endContainer, range.endOffset);
  if (start === null || end === null || start === end) return null;
  return { start, end };
}

function bodyOffsetForDisplayBoundary(container: HTMLElement, node: Node, offset: number) {
  const element = node instanceof Element ? node : node.parentNode instanceof Element ? node.parentNode : null;
  const paragraph = element?.closest("[data-body-start]");
  if (!(paragraph instanceof HTMLElement) || !container.contains(paragraph)) return null;
  const bodyStart = Number(paragraph.dataset.bodyStart);
  if (Number.isNaN(bodyStart)) return null;

  const preRange = document.createRange();
  preRange.selectNodeContents(paragraph);
  preRange.setEnd(node, offset);
  return bodyStart + preRange.toString().length;
}

function selectionPopoverAnchors(selection: Selection | null) {
  const rect = selectionRangeRect(selection);
  return selectionAnchorsFromRect(rect ?? fallbackSelectionRect());
}

function codeMirrorSelectionAnchors(view: EditorView, selectionStart: number, selectionEnd: number) {
  const nativeSelectionRect = selectionRangeRectWithin(window.getSelection(), view.dom);
  if (nativeSelectionRect) return selectionAnchorsFromRect(nativeSelectionRect);

  const startRect = view.coordsAtPos(selectionStart, -1);
  const endRect = view.coordsAtPos(selectionEnd, 1);
  return selectionAnchorsFromRect(mergeSelectionRects(startRect, endRect) ?? codeMirrorFallbackSelectionRect(view));
}

function selectionRangeRect(selection: Selection | null) {
  if (!selection?.rangeCount) return null;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (hasVisibleRect(rect)) return rect;

  return Array.from(range.getClientRects()).find(hasVisibleRect) ?? null;
}

function selectionRangeRectWithin(selection: Selection | null, container: HTMLElement) {
  if (!selection?.rangeCount) return null;

  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  return selectionRangeRect(selection);
}

function mergeSelectionRects(startRect: RectCoordinates | null, endRect: RectCoordinates | null) {
  if (!startRect && !endRect) return null;
  if (!startRect) return selectionRectFromCoordinates(endRect!);
  if (!endRect) return selectionRectFromCoordinates(startRect);

  const left = Math.min(startRect.left, endRect.left);
  const right = Math.max(startRect.right, endRect.right);
  const top = Math.min(startRect.top, endRect.top);
  const bottom = Math.max(startRect.bottom, endRect.bottom);
  return selectionRectFromCoordinates({ bottom, left, right, top });
}

function selectionRectFromCoordinates({ bottom, left, right, top }: RectCoordinates): SelectionRect {
  return {
    bottom,
    height: Math.max(0, bottom - top),
    left,
    right,
    top,
    width: Math.max(0, right - left),
    x: left,
    y: top
  };
}

function codeMirrorFallbackSelectionRect(view: EditorView): SelectionRect {
  const rect = view.dom.getBoundingClientRect();
  return {
    bottom: rect.top + 56,
    height: 20,
    left: rect.left + 12,
    right: rect.left + 72,
    top: rect.top + 36,
    width: 60,
    x: rect.left + 12,
    y: rect.top + 36
  };
}

function hasVisibleRect(rect: SelectionRect) {
  return rect.width > 0 || rect.height > 0;
}

function textareaSelectionAnchors(textarea: HTMLTextAreaElement) {
  const rect = textarea.getBoundingClientRect();
  return selectionAnchorsFromRect({
    bottom: rect.top + 56,
    height: 20,
    left: rect.left + 12,
    right: rect.left + 72,
    top: rect.top + 36,
    width: 60,
    x: rect.left + 12,
    y: rect.top + 36
  });
}

function selectionAnchorsFromRect(rect: SelectionRect) {
  return {
    actions: boundedPopoverAnchor(rect, { align: "center", height: 38, width: 142 }),
    editor: boundedPopoverAnchor(rect, { align: "left", height: 260, width: 320 })
  };
}

function boundedPopoverAnchor(
  rect: SelectionRect,
  { align, height, width }: { align: "center" | "left"; height: number; width: number }
) {
  const edgeGap = 12;
  const anchorGap = 8;
  const viewportWidth = typeof window === "undefined" ? width + edgeGap * 2 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? height + edgeGap * 2 : window.innerHeight;
  const maxLeft = Math.max(edgeGap, viewportWidth - width - edgeGap);
  const preferredLeft = align === "center" ? rect.left + rect.width / 2 - width / 2 : rect.left;
  const belowTop = rect.bottom + anchorGap;
  const aboveTop = rect.top - height - anchorGap;
  const maxTop = Math.max(edgeGap, viewportHeight - height - edgeGap);
  const preferredTop = belowTop + height <= viewportHeight - edgeGap ? belowTop : aboveTop;

  return {
    left: clamp(preferredLeft, edgeGap, maxLeft),
    top: clamp(preferredTop, edgeGap, maxTop)
  };
}

function fallbackSelectionRect(): SelectionRect {
  return {
    bottom: 24,
    height: 0,
    left: 24,
    right: 24,
    top: 24,
    width: 0,
    x: 24,
    y: 24
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
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

function cleanHashtagLabel(tag: string) {
  return tag.trim().replace(/^#+|#+$/g, "").trim();
}

function normalizedHashtags(hashtags: string[], platform: PublishPlatform) {
  const labels = hashtags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map(cleanHashtagLabel)
    .filter(Boolean);

  return labels.map((tag) => (platform === "weibo" ? `#${tag}#` : `#${tag}`));
}

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

type DiffToken = {
  type: "same" | "added" | "removed";
  value: string;
};

type DiffField = "title" | "body" | "hashtags" | "imagePrompt";
type LiveDiffStreamingField = Extract<DiffField, "body" | "imagePrompt">;
type PublishPlatform = "weibo" | "xiaohongshu" | "moments";
type PublishCopyAction = "weibo" | "xiaohongshu" | "moments" | "title" | "body" | "hashtags" | "imagePrompt";
type PublishCheck = {
  text: string;
  tone: "ok" | "warn" | "neutral";
};
type PublishTextByPlatform = Record<PublishPlatform, string>;
type SelectionMode = "actions" | "edit";
type SelectionAnchor = { left: number; top: number };
type SelectionRect = Pick<DOMRect, "bottom" | "height" | "left" | "right" | "top" | "width" | "x" | "y">;
type RectCoordinates = Pick<SelectionRect, "bottom" | "left" | "right" | "top">;

type CapturedTextSelection = {
  anchors: { actions: SelectionAnchor; editor: SelectionAnchor };
  selectedText: string;
  selectionEnd: number;
  selectionStart: number;
};

type SelectionEditState = CapturedTextSelection & {
  draft: Draft;
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
  onSelectText,
  original,
  rows,
  streamingLinePosition = null,
  value
}: {
  className?: string;
  disabled?: boolean;
  label: string;
  onChange?: (value: string) => void;
  onSelectText?: (selection: CapturedTextSelection) => void;
  original: string;
  rows: number;
  streamingLinePosition?: number | null;
  value: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectTextRef = useRef(onSelectText);
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
    onSelectTextRef.current = onSelectText;
  }, [onSelectText]);

  useEffect(() => {
    streamingLinePositionRef.current = streamingLinePosition;
    const view = viewRef.current;
    view?.dispatch({});
    scrollStreamingLineIntoView(view, streamingLinePosition);
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
    scrollStreamingLineIntoView(view, streamingLinePositionRef.current);
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
    scrollStreamingLineIntoView(view, streamingLinePositionRef.current);
  }, [value]);

  function captureSelection() {
    const view = viewRef.current;
    if (!view || !onSelectTextRef.current) return;

    const nativeSelection = codeMirrorNativeSelection(view);
    if (nativeSelection) {
      onSelectTextRef.current(nativeSelection);
      return;
    }

    const range = view.state.selection.main;
    const selectionStart = Math.min(range.from, range.to);
    const selectionEnd = Math.max(range.from, range.to);
    if (selectionStart === selectionEnd) return;

    const selectedText = view.state.sliceDoc(selectionStart, selectionEnd);
    if (!selectedText.trim()) return;

    onSelectTextRef.current({
      anchors: codeMirrorSelectionAnchors(view, selectionStart, selectionEnd),
      selectedText,
      selectionEnd,
      selectionStart
    });
  }

  return (
    <section
      className={`draft-cm-diff-field${className ? ` ${className}` : ""}`}
      onMouseUp={captureSelection}
      style={{ "--draft-cm-min-lines": rows } as CSSProperties}
    >
      <span className="draft-cm-diff-field__label">{label}</span>
      <div className="draft-cm-diff-field__editor" data-diff-editor-label={label} ref={containerRef} />
    </section>
  );
}

function codeMirrorNativeSelection(view: EditorView): CapturedTextSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;

  const range = selection.getRangeAt(0);
  if (!view.dom.contains(range.startContainer) || !view.dom.contains(range.endContainer)) return null;

  try {
    const start = view.posAtDOM(range.startContainer, range.startOffset);
    const end = view.posAtDOM(range.endContainer, range.endOffset);
    const selectionStart = Math.min(start, end);
    const selectionEnd = Math.max(start, end);
    if (selectionStart === selectionEnd) return null;

    const selectedText = view.state.sliceDoc(selectionStart, selectionEnd);
    if (!selectedText.trim()) return null;

    return {
      anchors: codeMirrorSelectionAnchors(view, selectionStart, selectionEnd),
      selectedText,
      selectionEnd,
      selectionStart
    };
  } catch {
    return null;
  }
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

function scrollStreamingLineIntoView(view: EditorView | null, position: number | null) {
  if (!view || position === null) return;

  view.requestMeasure({
    read: () => view.dom.querySelector(".cm-stream-current-line"),
    write: (currentLine) => {
      if (!(currentLine instanceof HTMLElement)) return;
      currentLine.scrollIntoView({ block: "center", inline: "nearest" });
    }
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

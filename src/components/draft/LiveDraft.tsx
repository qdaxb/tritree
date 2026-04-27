"use client";

import { type ReactNode, type Ref, useEffect, useMemo, useRef, useState } from "react";
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
  onSave,
  onStartComparison,
  previousDraft = null,
  publishPackage
}: {
  canCompareDrafts?: boolean;
  comparisonDrafts?: { from: Draft; to: Draft } | null;
  comparisonLabels?: { from: string; to: string } | null;
  comparisonSelectionCount?: number;
  draft: Draft | null;
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
  onSave?: (draft: Draft) => void | Promise<void>;
  onStartComparison?: () => void;
  previousDraft?: Draft | null;
  publishPackage: PublishPackage | null;
}) {
  const content = publishPackage ?? draft;
  const [diffEditDraft, setDiffEditDraft] = useState<Draft | null>(null);
  const [selectedDiffAction, setSelectedDiffAction] = useState<SelectedDiffAction | null>(null);
  const [editingMode, setEditingMode] = useState<"normal" | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const activeStreamingLineRef = useRef<HTMLSpanElement | null>(null);
  const displayContent = diffEditDraft ?? comparisonDrafts?.to ?? content;
  const displayTitle = resolveDraftTitle(displayContent?.title, displayContent?.body);
  const bodyParagraphs = splitDraftParagraphs(displayContent?.body);
  const isEditing = editingMode !== null && !isLiveDiff;
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
  const hasActiveStreamingLine = Boolean(
    isLiveDiffStreaming && (liveStreamingField === "body" || liveStreamingField === "imagePrompt")
  );
  const canShowParentDiff = Boolean(content && previousDraft && !publishPackage && !isEditing);
  const canUseTreeComparison = Boolean(onStartComparison || onCancelComparison || isComparisonMode);
  const canDismissLiveDiff = Boolean(content && isLiveDiff && !isLiveDiffStreaming && onDismissLiveDiff);
  const canShowDiffControl = Boolean(
    content &&
      !publishPackage &&
      !isEditing &&
      (canDismissLiveDiff || (!isLiveDiff && (canCompareDrafts || canShowParentDiff || isComparisonMode)))
  );
  const draftDiff = useMemo(
    () => {
      if (comparisonDrafts) return buildDraftDiff(comparisonDrafts.from, diffEditDraft ?? comparisonDrafts.to);
      return content && previousDraft
        ? buildDraftDiff(previousDraft, content, { streamingField: liveStreamingField })
        : null;
    },
    [comparisonDrafts, content, diffEditDraft, liveStreamingField, previousDraft]
  );
  const shouldShowInlineDiff = Boolean(
    draftDiff && !publishPackage && !isEditing && (comparisonDrafts || (showDiff && canShowParentDiff) || isLiveDiff)
  );
  const canEditCurrentDraft = Boolean(content && isEditable && !publishPackage && !isComparisonMode && !isLiveDiff);
  const canUseInlineDiffEditing = Boolean(shouldShowInlineDiff && isEditable && !publishPackage && !isLiveDiff && onSave);
  const selectedDiffToken =
    selectedDiffAction && draftDiff ? draftDiff[selectedDiffAction.field][selectedDiffAction.tokenIndex] : null;
  const selectedDiffPopoverPosition = selectedDiffAction ? diffPopoverPosition(selectedDiffAction.anchorRect) : null;

  useEffect(() => {
    setEditingMode(null);
    setDiffEditDraft(null);
    setSelectedDiffAction(null);
    setShowDiff(false);
    setTitle(resolveDraftTitle(content?.title, content?.body));
    setBody(content?.body ?? "");
    setHashtags(content?.hashtags.join(" ") ?? "");
    setImagePrompt(content?.imagePrompt ?? "");
  }, [content?.title, content?.body, content?.imagePrompt, content?.hashtags]);

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

  useEffect(() => {
    if (!hasActiveStreamingLine) return;
    const activeLine = activeStreamingLineRef.current;
    if (typeof activeLine?.scrollIntoView !== "function") return;
    activeLine.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [content?.body, content?.hashtags, content?.imagePrompt, content?.title, hasActiveStreamingLine, liveStreamingField]);

  function startEditing() {
    if (!content) return;

    setTitle(resolveDraftTitle(content.title, content.body));
    setBody(content.body);
    setHashtags(content.hashtags.join(" "));
    setImagePrompt(content.imagePrompt);
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

    await onSave({
      title,
      body,
      hashtags: hashtags
        .split(/[\s,，]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      imagePrompt
    });
    setEditingMode(null);
  }

  function cancelEditing() {
    setEditingMode(null);
  }

  async function saveInlineDiffDraft() {
    if (!onSave || !diffEditDraft) return;

    await onSave(diffEditDraft);
    setDiffEditDraft(null);
    setSelectedDiffAction(null);
  }

  function cancelInlineDiffDraft() {
    setDiffEditDraft(null);
    setSelectedDiffAction(null);
  }

  function applyInlineDiffAction(field: DiffField, tokenIndex: number) {
    if (!displayContent || !draftDiff) return;
    const tokens = draftDiff[field];
    if (field === "hashtags") {
      setDiffEditDraft({
        ...displayContent,
        hashtags: revertHashtagDiffToken(tokens, tokenIndex)
      });
      setSelectedDiffAction(null);
      return;
    }

    const nextValue = revertDiffToken(diffFieldValue(displayContent, field), tokens, tokenIndex);
    setDiffEditDraft(updateDiffDraftField(displayContent, field, nextValue));
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

  return (
    <aside className="draft-panel">
      <div className="panel-heading">
        <Sparkles size={16} />
        <span>{publishPackage ? "发布包" : mode === "history" ? "历史草稿" : "实时草稿"}</span>
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
              <textarea onChange={(event) => setBody(event.target.value)} rows={10} value={body} />
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
                取消
              </button>
              <button className="start-button" disabled={isBusy} onClick={() => void saveDraft()} type="button">
                保存为自定义编辑
              </button>
            </div>
          </div>
        ) : content ? (
          <div className="draft-content">
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
                    activeLineRef={liveStreamingField === "body" ? activeStreamingLineRef : undefined}
                    field="body"
                    isInteractive={canUseInlineDiffEditing}
                    onSelect={selectDiffAction}
                    selectedAction={selectedDiffAction}
                    tokens={draftDiff.body}
                  />
                </p>
              ) : (
                bodyParagraphs.map((paragraph, index) => <p key={`${index}-${paragraph}`}>{paragraph}</p>)
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
                    activeLineRef={liveStreamingField === "imagePrompt" ? activeStreamingLineRef : undefined}
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
            {diffEditDraft ? (
              <div className="draft-diff-inline-actions">
                <button className="secondary-button" disabled={isBusy} onClick={cancelInlineDiffDraft} type="button">
                  取消修改
                </button>
                <button className="start-button" disabled={isBusy} onClick={() => void saveInlineDiffDraft()} type="button">
                  保存为自定义编辑
                </button>
              </div>
            ) : null}
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
          <p className="empty-copy">开始创作后，草稿会在这里同步更新。</p>
        )}
      </div>
    </aside>
  );
}

function splitDraftParagraphs(body?: string) {
  const paragraphs = body
    ?.split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs?.length ? paragraphs : ["第一次选择后，草稿会在这里更新。"];
}

type DiffToken = {
  type: "same" | "added" | "removed" | "active";
  value: string;
};

type DiffField = "title" | "body" | "hashtags" | "imagePrompt";
type LiveDiffStreamingField = Extract<DiffField, "body" | "imagePrompt">;

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
  activeLineRef,
  field,
  isInteractive = false,
  onSelect,
  selectedAction,
  tokens
}: {
  activeLineRef?: Ref<HTMLSpanElement>;
  field?: DiffField;
  isInteractive?: boolean;
  onSelect?: (action: Omit<SelectedDiffAction, "anchorElement" | "anchorRect">, element: Element) => void;
  selectedAction?: SelectedDiffAction | null;
  tokens: DiffToken[];
}) {
  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === "active") {
          return (
            <span className="draft-stream-current-line" key={`${index}-active-${token.value}`} ref={activeLineRef}>
              {token.value ? <span className="draft-diff-token draft-diff-token--added">{token.value}</span> : null}
              <span aria-label="正在生成到这里" className="draft-stream-cursor" />
            </span>
          );
        }

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

function buildDraftDiff(previousDraft: Draft, currentDraft: Draft, options: { streamingField?: LiveDiffStreamingField | null } = {}) {
  const previousImagePrompt = previousDraft.imagePrompt || "还没有配图方向。";
  const currentImagePrompt = currentDraft.imagePrompt || "还没有配图方向。";
  const streamingImagePrompt = currentDraft.imagePrompt || previousImagePrompt;

  return {
    title: diffText(resolveDraftTitle(previousDraft.title, previousDraft.body), resolveDraftTitle(currentDraft.title, currentDraft.body)),
    body: options.streamingField === "body" ? diffStreamingText(previousDraft.body, currentDraft.body) : diffText(previousDraft.body, currentDraft.body),
    hashtags: diffHashtags(previousDraft.hashtags, currentDraft.hashtags),
    imagePrompt:
      options.streamingField === "imagePrompt"
        ? diffStreamingText(previousImagePrompt, streamingImagePrompt)
        : diffText(previousImagePrompt, currentImagePrompt)
  };
}

function diffStreamingText(previousText: string, currentPartialText: string): DiffToken[] {
  if (!currentPartialText || currentPartialText === previousText) {
    const tokens: DiffToken[] = [{ type: "active", value: "" }];
    pushDiffToken(tokens, "same", previousText, true);
    return tokens;
  }

  const prefixLength = commonPrefixLength(previousText, currentPartialText);
  const coveredPreviousLength = Math.min(previousText.length, Math.max(prefixLength, currentPartialText.length));
  const samePrefix = previousText.slice(0, prefixLength);
  const generatedText = currentPartialText.slice(prefixLength);
  const unchangedTail = previousText.slice(coveredPreviousLength);
  const { activeLine, generatedBeforeActiveLine } = splitStreamingActiveLine(generatedText);
  const tokens: DiffToken[] = [];

  pushDiffToken(tokens, "same", samePrefix, true);
  pushDiffToken(tokens, "added", generatedBeforeActiveLine, true);
  tokens.push({ type: "active", value: activeLine });
  pushDiffToken(tokens, "same", unchangedTail, true);

  return tokens;
}

function splitStreamingActiveLine(generatedText: string) {
  const lastLineBreakIndex = Math.max(generatedText.lastIndexOf("\n"), generatedText.lastIndexOf("\r"));
  if (lastLineBreakIndex < 0) {
    return { activeLine: generatedText, generatedBeforeActiveLine: "" };
  }

  return {
    activeLine: generatedText.slice(lastLineBreakIndex + 1),
    generatedBeforeActiveLine: generatedText.slice(0, lastLineBreakIndex + 1)
  };
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

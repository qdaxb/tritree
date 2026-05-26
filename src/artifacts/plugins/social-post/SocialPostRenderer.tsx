"use client";

import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";
import { Copy, Send, Sparkles, X } from "lucide-react";
import type { ArtifactRendererProps } from "@/artifacts/types";
import { SocialPostPayloadSchema, type SocialPostPayload } from "./schema";

type SelectionMode = "actions" | "edit";
type PublishPlatform = "weibo" | "xiaohongshu" | "moments";
type PublishCopyAction = PublishPlatform | "title" | "hashtags" | "imagePrompt";
type PublishTextByPlatform = Record<PublishPlatform, string>;

type CapturedTextSelection = {
  selectedText: string;
  selectionEnd: number;
  selectionStart: number;
};

type DiffSegment = {
  text: string;
  type: "added" | "removed" | "same";
};

export function SocialPostRenderer({ artifact, isBusy, onAction, onSave, previousArtifact, publishPlatforms }: ArtifactRendererProps) {
  const activePlatforms = (publishPlatforms?.length ? publishPlatforms : ["weibo", "xiaohongshu", "moments"]) as PublishPlatform[];
  const parsed = SocialPostPayloadSchema.safeParse(artifact.payload);
  const payload = parsed.success ? parsed.data : null;
  const previousPayload = previousArtifact?.type === artifact.type ? SocialPostPayloadSchema.safeParse(previousArtifact.payload) : null;
  const previousSocialPayload = previousPayload?.success ? previousPayload.data : null;
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(() => payload?.title ?? "");
  const [body, setBody] = useState(() => payload?.body ?? "");
  const [hashtags, setHashtags] = useState(() => payload?.hashtags.join(" ") ?? "");
  const [imagePrompt, setImagePrompt] = useState(() => payload?.imagePrompt ?? "");
  const [selectionEdit, setSelectionEdit] = useState<CapturedTextSelection | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("actions");
  const [selectionInstruction, setSelectionInstruction] = useState("");
  const [isSelectionRewritePending, setIsSelectionRewritePending] = useState(false);
  const [isPublishPanelOpen, setIsPublishPanelOpen] = useState(false);
  const [activePublishPlatform, setActivePublishPlatform] = useState<PublishPlatform>(() => activePlatforms[0] ?? "weibo");
  const [publishTexts, setPublishTexts] = useState<PublishTextByPlatform>(() => publishTextsFromPayload(payload));
  const [publishImagePrompt, setPublishImagePrompt] = useState(() => payload?.imagePrompt ?? "");
  const [copiedPublishAction, setCopiedPublishAction] = useState<PublishCopyAction | null>(null);
  const [publishCopyError, setPublishCopyError] = useState("");

  const editedPayload = useMemo<SocialPostPayload>(
    () => ({
      title,
      body,
      hashtags: parseHashtags(hashtags),
      imagePrompt
    }),
    [body, hashtags, imagePrompt, title]
  );

  useEffect(() => {
    if (!payload) return;
    setIsEditing(false);
    setTitle(payload.title);
    setBody(payload.body);
    setHashtags(payload.hashtags.join(" "));
    setImagePrompt(payload.imagePrompt);
    setPublishTexts(publishTextsFromPayload(payload));
    setPublishImagePrompt(payload.imagePrompt);
    closeSelectionEdit();
    setIsPublishPanelOpen(false);
    setCopiedPublishAction(null);
    setPublishCopyError("");
  }, [artifact.id, payload?.title, payload?.body, payload?.imagePrompt, payload?.hashtags.join("\u0000")]);

  useEffect(() => {
    setActivePublishPlatform((current) => (activePlatforms.includes(current) ? current : activePlatforms[0] ?? "weibo"));
  }, [activePlatforms.join(",")]);

  if (!payload) {
    return (
      <article className="artifact-renderer" data-testid="social-post-renderer">
        <h3>{artifact.type}</h3>
        <pre>{JSON.stringify(artifact.payload, null, 2)}</pre>
      </article>
    );
  }

  const payloadBody = payload.body;
  const displayTitle = resolveSocialPostTitle(payload.title, payload.body);
  const previousDisplayTitle = previousSocialPayload
    ? resolveSocialPostTitle(previousSocialPayload.title, previousSocialPayload.body)
    : "";
  const shouldShowInlineDiff = Boolean(previousSocialPayload && previousArtifact?.id !== artifact.id);
  const bodyParagraphs = splitBodyParagraphsWithOffsets(payloadBody);
  const canUseSelectionRewrite = Boolean(onAction);

  async function saveEditedPayload() {
    await onSave?.(editedPayload);
    setIsEditing(false);
  }

  function cancelEditing() {
    setTitle(payload?.title ?? "");
    setBody(payload?.body ?? "");
    setHashtags(payload?.hashtags.join(" ") ?? "");
    setImagePrompt(payload?.imagePrompt ?? "");
    setIsEditing(false);
  }

  function preserveDisplayBodySelection(event: ReactMouseEvent<HTMLDivElement>) {
    if (!selectionEdit) return;
    event.preventDefault();
    closeSelectionEdit();
  }

  function captureDisplayBodySelection(event: ReactMouseEvent<HTMLDivElement>) {
    if (!canUseSelectionRewrite) return;
    const container = event.currentTarget;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;

    const offsets = bodyOffsetsForDisplayRange(container, range);
    const selectedText = offsets ? payloadBody.slice(offsets.start, offsets.end) : "";
    if (!offsets || !selectedText.trim()) return;

    setSelectionEdit({
      selectedText,
      selectionEnd: offsets.end,
      selectionStart: offsets.start
    });
    setSelectionInstruction("");
    setSelectionMode("actions");
  }

  async function submitSelectionRewrite() {
    if (!selectionEdit || !selectionInstruction.trim()) return;
    setIsSelectionRewritePending(true);
    try {
      await onAction?.("rewrite-selection", {
        field: "body",
        instruction: selectionInstruction.trim(),
        selectedText: selectionEdit.selectedText,
        selectionEnd: selectionEdit.selectionEnd,
        selectionStart: selectionEdit.selectionStart
      });
      closeSelectionEdit();
    } finally {
      setIsSelectionRewritePending(false);
    }
  }

  async function copySelectionText() {
    if (!selectionEdit) return;
    await copyTextToClipboard(selectionEdit.selectedText);
    closeSelectionEdit();
  }

  async function copyPublishText(action: PublishCopyAction) {
    setPublishCopyError("");
    try {
      await copyTextToClipboard(publishCopyValue(payload!, activePublishPlatform, action, publishTexts, publishImagePrompt));
      setCopiedPublishAction(action);
    } catch {
      setPublishCopyError("复制失败，请手动选择文本。");
    }
  }

  function togglePublishPanel() {
    setPublishCopyError("");
    setCopiedPublishAction(null);
    setIsPublishPanelOpen((open) => !open);
  }

  function enterEditMode() {
    setIsPublishPanelOpen(false);
    setPublishCopyError("");
    setCopiedPublishAction(null);
    setIsEditing(true);
  }

  function closeSelectionEdit() {
    setSelectionEdit(null);
    setSelectionMode("actions");
    setSelectionInstruction("");
  }

  function updateActivePublishText(value: string) {
    setPublishTexts((current) => ({
      ...current,
      [activePublishPlatform]: value
    }));
    setCopiedPublishAction(null);
    setPublishCopyError("");
  }

  function updatePublishImagePrompt(value: string) {
    setPublishImagePrompt(value);
    setCopiedPublishAction(null);
    setPublishCopyError("");
  }

  return (
    <article aria-busy={isBusy} className="social-post-panel" data-testid="social-post-renderer">
      <div className="panel-heading">
        <Sparkles size={16} />
        <span>社媒内容</span>
        <div className="social-post-panel__actions">
          {onSave ? (
            <button className="work-edit-button" disabled={isBusy} onClick={enterEditMode} type="button">
              编辑
            </button>
          ) : null}
        </div>
      </div>

      <div className="social-post-panel__primary-action">
        <button
          aria-expanded={isPublishPanelOpen}
          className="work-publish-button"
          disabled={isBusy}
          onClick={togglePublishPanel}
          type="button"
        >
          <Send aria-hidden="true" size={13} />
          <span>发布</span>
        </button>
      </div>

      {isPublishPanelOpen ? (
        <aside aria-label="发布助手" className="work-publish-panel" role="dialog">
          <div className="work-publish-panel__header">
            <div>
              <p className="work-publish-panel__title">发布助手</p>
              <p className="work-publish-panel__copy">生成适合平台的复制版本</p>
            </div>
            <button
              aria-label="关闭发布助手"
              className="work-publish-panel__close"
              onClick={() => setIsPublishPanelOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
          {activePlatforms.length > 1 ? (
            <div aria-label="发布平台" className="work-publish-tabs" role="group">
              {activePlatforms.map((platform) => (
                <button
                  aria-pressed={activePublishPlatform === platform}
                  key={platform}
                  onClick={() => {
                    setActivePublishPlatform(platform);
                    setCopiedPublishAction(null);
                  }}
                  type="button"
                >
                  {publishPlatformLabel(platform)}
                </button>
              ))}
            </div>
          ) : null}
          <section className="work-publish-preview" aria-label={`${publishPlatformLabel(activePublishPlatform)}版预览`}>
            <div className="work-publish-preview__meta">
              <span>{publishPlatformLabel(activePublishPlatform)}版预览</span>
              <span>约 {publishTexts[activePublishPlatform].length} 字</span>
            </div>
            <textarea
              aria-label={`${publishPlatformLabel(activePublishPlatform)}发布文案`}
              onChange={(event) => updateActivePublishText(event.target.value)}
              rows={7}
              value={publishTexts[activePublishPlatform]}
            />
            <div className="work-publish-actions">
              <button
                className="work-publish-actions__primary"
                onClick={() => void copyPublishText(activePublishPlatform)}
                type="button"
              >
                <Copy aria-hidden="true" size={13} />
                <span>{copiedPublishAction === activePublishPlatform ? "已复制" : `复制${publishPlatformLabel(activePublishPlatform)}文案`}</span>
              </button>
            </div>
          </section>
          <section className="work-publish-image-prompt">
            <div className="work-publish-image-prompt__meta">
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
              onChange={(event) => updatePublishImagePrompt(event.target.value)}
              placeholder="还没有配图提示。"
              rows={3}
              value={publishImagePrompt}
            />
          </section>
          {publishCopyError ? (
            <p className="work-publish-error" role="status">
              {publishCopyError}
            </p>
          ) : null}
        </aside>
      ) : null}

      <div className="social-post-panel__scroll">
        {isEditing ? (
          <div className="work-editor">
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
            <div className="work-editor__actions">
              <button className="secondary-button" disabled={isBusy} onClick={cancelEditing} type="button">
                退出编辑
              </button>
              <button className="start-button" disabled={isBusy} onClick={() => void saveEditedPayload()} type="button">
                保存作品
              </button>
            </div>
          </div>
        ) : (
          <div className="work-content">
            <h2>
              {shouldShowInlineDiff ? (
                <InlineDiffText current={displayTitle} previous={previousDisplayTitle} />
              ) : (
                displayTitle
              )}
            </h2>
            <div className="work-body" onMouseDown={preserveDisplayBodySelection} onMouseUp={captureDisplayBodySelection}>
              {shouldShowInlineDiff && previousSocialPayload ? (
                <div className="work-inline-diff" data-testid="social-post-inline-diff">
                  <InlineDiffText current={payloadBody} previous={previousSocialPayload.body} />
                </div>
              ) : (
                bodyParagraphs.map((paragraph) => (
                  <p data-body-end={paragraph.end} data-body-start={paragraph.start} key={`${paragraph.start}-${paragraph.text}`}>
                    {paragraph.text}
                  </p>
                ))
              )}
            </div>
            {payload.hashtags.length ? (
              <div className="tag-row">
                {shouldShowInlineDiff && previousSocialPayload ? (
                  <InlineDiffText current={payload.hashtags.join(" ")} previous={previousSocialPayload.hashtags.join(" ")} />
                ) : (
                  payload.hashtags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))
                )}
              </div>
            ) : null}
            <section className="image-prompt">
              <div className="image-prompt__heading">
                <h3>配图提示</h3>
              </div>
              <p>{payload.imagePrompt || "还没有配图方向。"}</p>
            </section>
          </div>
        )}
      </div>

      {selectionEdit ? (
        selectionMode === "actions" ? (
          <div aria-label="选中文本操作" className="work-selection-actions" role="toolbar">
            <button onClick={() => setSelectionMode("edit")} type="button">
              引用
            </button>
            <button onClick={() => void copySelectionText()} type="button">
              复制
            </button>
          </div>
        ) : (
          <div aria-label="引用选中文本修改" className="work-selection-edit" role="dialog">
            <p className="work-selection-edit__preview">{previewSelectionText(selectionEdit.selectedText)}</p>
            <label>
              <span>修改要求</span>
              <textarea
                autoFocus
                onChange={(event) => setSelectionInstruction(event.target.value)}
                rows={3}
                value={selectionInstruction}
              />
            </label>
            <div className="work-selection-edit__actions">
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
        )
      ) : null}
    </article>
  );
}

function InlineDiffText({ current, previous }: { current: string; previous: string }) {
  return (
    <>
      {diffText(previous, current).map((segment, index) => (
        <span className={`work-diff-token work-diff-token--${segment.type}`} key={`${segment.type}-${index}-${segment.text}`}>
          {segment.text}
        </span>
      ))}
    </>
  );
}

function diffText(previous: string, current: string): DiffSegment[] {
  if (previous === current) return previous ? [{ text: previous, type: "same" }] : [];

  const previousTokens = tokenizeDiffText(previous);
  const currentTokens = tokenizeDiffText(current);
  const matrix = longestCommonSubsequenceMatrix(previousTokens, currentTokens);
  const segments: DiffSegment[] = [];
  let previousIndex = previousTokens.length;
  let currentIndex = currentTokens.length;

  while (previousIndex > 0 || currentIndex > 0) {
    if (
      previousIndex > 0 &&
      currentIndex > 0 &&
      previousTokens[previousIndex - 1] === currentTokens[currentIndex - 1]
    ) {
      segments.push({ text: previousTokens[previousIndex - 1], type: "same" });
      previousIndex -= 1;
      currentIndex -= 1;
      continue;
    }

    if (currentIndex > 0 && (previousIndex === 0 || matrix[previousIndex][currentIndex - 1] >= matrix[previousIndex - 1][currentIndex])) {
      segments.push({ text: currentTokens[currentIndex - 1], type: "added" });
      currentIndex -= 1;
      continue;
    }

    if (previousIndex > 0) {
      segments.push({ text: previousTokens[previousIndex - 1], type: "removed" });
      previousIndex -= 1;
    }
  }

  return mergeAdjacentDiffSegments(segments.reverse());
}

function tokenizeDiffText(value: string) {
  return value.match(/(\s+|[\p{Script=Han}]|[A-Za-z0-9_]+|[^\s])/gu) ?? [];
}

function longestCommonSubsequenceMatrix(previousTokens: string[], currentTokens: string[]) {
  const matrix = Array.from({ length: previousTokens.length + 1 }, () => Array(currentTokens.length + 1).fill(0) as number[]);

  for (let previousIndex = 1; previousIndex <= previousTokens.length; previousIndex += 1) {
    for (let currentIndex = 1; currentIndex <= currentTokens.length; currentIndex += 1) {
      matrix[previousIndex][currentIndex] =
        previousTokens[previousIndex - 1] === currentTokens[currentIndex - 1]
          ? matrix[previousIndex - 1][currentIndex - 1] + 1
          : Math.max(matrix[previousIndex - 1][currentIndex], matrix[previousIndex][currentIndex - 1]);
    }
  }

  return matrix;
}

function mergeAdjacentDiffSegments(segments: DiffSegment[]) {
  return segments.reduce<DiffSegment[]>((merged, segment) => {
    const previous = merged.at(-1);
    if (previous?.type === segment.type) {
      previous.text += segment.text;
      return merged;
    }

    merged.push({ ...segment });
    return merged;
  }, []);
}

function splitBodyParagraphsWithOffsets(body: string) {
  const matches = Array.from(body.matchAll(/[^\n]+/g));
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

function parseHashtags(value: string) {
  return value
    .split(/[\s,，]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizedHashtags(hashtags: string[], platform: PublishPlatform) {
  const labels = hashtags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.replace(/^#+|#+$/g, "").trim())
    .filter(Boolean);

  return labels.map((tag) => (platform === "weibo" ? `#${tag}#` : `#${tag}`));
}

function formatPublishText(payload: SocialPostPayload, platform: PublishPlatform) {
  if (platform === "moments") return payload.body.trim();

  const body = payload.body.trim();
  const hashtags = normalizedHashtags(payload.hashtags, platform).join(" ");
  return [body, hashtags].filter(Boolean).join("\n\n");
}

function publishTextsFromPayload(payload: SocialPostPayload | null): PublishTextByPlatform {
  return {
    weibo: payload ? formatPublishText(payload, "weibo") : "",
    xiaohongshu: payload ? formatPublishText(payload, "xiaohongshu") : "",
    moments: payload ? formatPublishText(payload, "moments") : ""
  };
}

function publishPlatformLabel(platform: PublishPlatform) {
  if (platform === "weibo") return "微博";
  if (platform === "xiaohongshu") return "小红书";
  return "朋友圈";
}

function publishCopyValue(
  payload: SocialPostPayload,
  platform: PublishPlatform,
  action: PublishCopyAction,
  publishTexts: PublishTextByPlatform,
  publishImagePrompt: string
) {
  if (action === "title") return resolveSocialPostTitle(payload.title, payload.body).trim();
  if (action === "hashtags") return normalizedHashtags(payload.hashtags, platform).join(" ");
  if (action === "imagePrompt") return publishImagePrompt;
  return publishTexts[action];
}

function resolveSocialPostTitle(title: string | undefined, body: string | undefined) {
  const trimmedTitle = title?.trim();
  if (trimmedTitle && trimmedTitle !== "种子念头") return trimmedTitle;
  return deriveSocialPostTitle(body ?? "");
}

function deriveSocialPostTitle(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  const [firstSegment = normalized] = normalized.split(/[。！？!?，,；;：:\n]/);
  const title = firstSegment.trim() || normalized;
  return Array.from(title).slice(0, 24).join("") || "未命名草稿";
}

function previewSelectionText(value: string) {
  const preview = value.replace(/\s+/g, " ").trim();
  return Array.from(preview).slice(0, 48).join("");
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

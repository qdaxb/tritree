"use client";

import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { Check, ExternalLink, GitCompare, X } from "lucide-react";
import type { Artifact, TreeNode } from "@/lib/domain";
import { getArtifactClientManifest, getArtifactRenderer } from "@/artifacts/client-registry";
import { ArtifactFallback } from "./ArtifactFallback";

export type ProcessMaterialItem = {
  meta?: string;
  subtitle?: string;
  title: string;
  url?: string;
  urls?: string[];
};

export type ProcessMaterial = {
  items: ProcessMaterialItem[];
  note?: string;
  sourceToolCallIds: string[];
  title: string;
};

type ArtifactTimelineBlock = {
  element: ReactNode;
  id: string;
  sortTime: number;
  tiePriority: number;
};

const SHOW_PROCESS_DATA_TOOL_NAME = "show_process_data";
const LATEST_TIMELINE_TIME = Number.POSITIVE_INFINITY;

export type ArtifactWorkspaceProps = {
  artifacts: Artifact[];
  canCompareArtifacts?: boolean;
  comparisonArtifacts?: { from: Artifact; to: Artifact } | null;
  comparisonLabels?: { from: string; to: string } | null;
  comparisonSelectionCount?: number;
  currentNode: TreeNode | null;
  generationStage?: "artifact" | "options" | null;
  headerActions?: ReactNode;
  headerPanel?: ReactNode;
  isBusy: boolean;
  isComparisonMode?: boolean;
  isGenerating: boolean;
  onAction: (actionId: string, artifact: Artifact, input?: unknown) => void | Promise<void>;
  onCancelComparison?: () => void;
  onSave: (artifact: Artifact) => void | Promise<void>;
  onStartComparison?: () => void;
  onStopGeneration?: () => void;
  publishPlatforms?: string[];
  selectedArtifactId: string | null;
  scrollBodyRef?: Ref<HTMLDivElement>;
  streamingProcessMaterials?: ProcessMaterial[];
  thinkingText?: string;
};

export function ArtifactWorkspace({
  artifacts,
  canCompareArtifacts = false,
  comparisonArtifacts = null,
  comparisonLabels = null,
  comparisonSelectionCount = 0,
  currentNode,
  generationStage = null,
  headerActions,
  headerPanel,
  isBusy,
  isComparisonMode = false,
  isGenerating,
  onAction,
  onCancelComparison,
  onSave,
  onStartComparison,
  onStopGeneration,
  publishPlatforms,
  selectedArtifactId,
  scrollBodyRef,
  streamingProcessMaterials = [],
  thinkingText
}: ArtifactWorkspaceProps) {
  const selectedArtifact = selectedArtifactId
    ? artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null
    : null;
  const processBodyRef = useRef<HTMLDivElement>(null);
  const previousArtifact = selectedArtifact ? previousArtifactForRenderer(selectedArtifact, artifacts, currentNode) : null;
  const selectedManifest = selectedArtifact ? getArtifactClientManifest(selectedArtifact.type) : null;
  const SelectedRenderer = selectedManifest ? getArtifactRenderer(selectedManifest.rendererKey) : null;
  const trimmedThinkingText = thinkingText?.trim() ?? "";
  const hasNoArtifactForCurrentNode = currentNode ? currentNode.producedArtifactId === null : false;
  const canUseComparison = canCompareArtifacts || isComparisonMode;
  const processMaterials = [...streamingProcessMaterials, ...processMaterialsForNode(currentNode)];
  const isStreamingProcessMaterials = isBusy && streamingProcessMaterials.length > 0;
  const isDraftGenerating = isBusy && generationStage === "artifact" && Boolean(selectedArtifact);
  const processTitle =
    generationStage === "artifact"
      ? "AI 正在思考下一版产物..."
      : generationStage === "options"
        ? "AI 正在生成下一步选项..."
        : "";
  const contentUpdatedAt = selectedArtifact
    ? timestampFromIso(selectedArtifact.updatedAt, timestampFromIso(selectedArtifact.createdAt))
    : LATEST_TIMELINE_TIME;
  const processMaterialsUpdatedAt = isStreamingProcessMaterials
    ? LATEST_TIMELINE_TIME
    : timestampFromIso(currentNode?.createdAt, 0);
  const contentBlock = (
    <div className={`artifact-workspace__content${isDraftGenerating ? " artifact-workspace__content--generating" : ""}`}>
      {isComparisonMode ? (
        <ArtifactComparisonView
          comparisonArtifacts={comparisonArtifacts}
          comparisonLabels={comparisonLabels}
          comparisonSelectionCount={comparisonSelectionCount}
          isBusy={isBusy}
        />
      ) : selectedArtifact ? (
        SelectedRenderer ? (
          <SelectedRenderer
            artifact={selectedArtifact}
            isBusy={isBusy}
            onAction={(actionId, input) => onAction(actionId, selectedArtifact, input)}
            onSave={(payload) => onSave({ ...selectedArtifact, payload: payload ?? selectedArtifact.payload })}
            previousArtifact={previousArtifact}
            publishPlatforms={publishPlatforms}
          />
        ) : (
          <ArtifactFallback artifact={selectedArtifact} />
        )
      ) : (
        <div className="artifact-workspace__empty">
          <p>还没有产物。</p>
        </div>
      )}
    </div>
  );
  const timelineBlockCandidates: Array<ArtifactTimelineBlock | null> = [
    processMaterials.length > 0
      ? {
          id: "materials",
          sortTime: processMaterialsUpdatedAt,
          tiePriority: 0,
          element: <ProcessMaterials isStreaming={isStreamingProcessMaterials} materials={processMaterials} />
        }
      : null,
    {
      id: "content",
      sortTime: contentUpdatedAt,
      tiePriority: 1,
      element: contentBlock
    }
  ];
  const timelineBlocks = timelineBlockCandidates
    .filter((block): block is ArtifactTimelineBlock => block !== null)
    .sort((first, second) => first.sortTime - second.sortTime || first.tiePriority - second.tiePriority);

  useEffect(() => {
    if (!isBusy || !generationStage) return;

    const processBody = processBodyRef.current;
    if (!processBody) return;

    processBody.scrollTop = processBody.scrollHeight;
  }, [generationStage, isBusy, trimmedThinkingText]);

  return (
    <aside
      aria-busy={isGenerating}
      aria-labelledby="artifact-workspace-title"
      className="artifact-workspace"
    >
      <header className="artifact-workspace__header">
        <h2 id="artifact-workspace-title">产物</h2>
        <div className="artifact-workspace__header-actions">
          {isGenerating && onStopGeneration ? (
            <button className="artifact-workspace__stop-button" onClick={onStopGeneration} type="button">
              <X aria-hidden="true" size={14} />
              <span>停止</span>
            </button>
          ) : null}
          {canUseComparison ? (
            <button
              aria-pressed={isComparisonMode}
              className="artifact-workspace__compare-button"
              disabled={isBusy && !isComparisonMode}
              onClick={isComparisonMode ? onCancelComparison : onStartComparison}
              type="button"
            >
              {isComparisonMode ? <X aria-hidden="true" size={14} /> : <GitCompare aria-hidden="true" size={14} />}
              <span>{isComparisonMode ? "退出对比" : "对比"}</span>
            </button>
          ) : null}
          {headerActions}
        </div>
      </header>
      {headerPanel}

      <div className="artifact-workspace__body" ref={scrollBodyRef}>
        {hasNoArtifactForCurrentNode || (isBusy && generationStage) ? (
          <div className="artifact-workspace__supplements">
            {hasNoArtifactForCurrentNode ? (
              <div className="artifact-workspace__status" role="status">
                本步未生成产物
              </div>
            ) : null}

            {isBusy && generationStage ? (
              <div
                aria-live="polite"
                className="artifact-workspace__process artifact-workspace__process--generating"
                role="status"
              >
                <div className="artifact-workspace__process-header">
                  <span className="artifact-workspace__process-dot" aria-hidden="true" />
                  <strong>{processTitle}</strong>
                </div>
                <div className="artifact-workspace__process-body" ref={processBodyRef}>
                  {trimmedThinkingText ? (
                    <ThinkingTextLines text={trimmedThinkingText} />
                  ) : generationStage === "artifact" ? (
                    "正在生成草稿内容。"
                  ) : (
                    "正在生成可选择方向。"
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {timelineBlocks.map((block) => (
          <div className="artifact-workspace__timeline-item" key={block.id}>
            {block.element}
          </div>
        ))}
      </div>
    </aside>
  );
}

function timestampFromIso(value: string | null | undefined, fallback = 0) {
  if (!value) return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

type ToolCallEntry = {
  count?: number;
  id: number;
  kind: "tool" | "subagent";
  label: string;
  status: "calling" | "done" | "failed";
};

type OtherLine = { kind: "text"; text: string };

type ThinkingLine = ToolCallEntry | OtherLine;

function parseThinkingLines(text: string): ThinkingLine[] {
  const rawLines = text.split("\n");
  const result: ThinkingLine[] = [];
  let idCounter = 0;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    const toolCallMatch = line.match(/^\[工具\] 调用 (.+)$/);
    if (toolCallMatch) {
      result.push({ id: idCounter++, kind: "tool", label: toolCallMatch[1], status: "calling" });
      continue;
    }

    const toolDoneMatch = line.match(/^\[工具\] (.+) (完成|失败)$/);
    if (toolDoneMatch) {
      const label = toolDoneMatch[1];
      const status = toolDoneMatch[2] === "完成" ? "done" : "failed";
      // 找最早的同名 calling 条目
      const pending = result.find(
        (e): e is ToolCallEntry => e.kind === "tool" && e.label === label && e.status === "calling"
      );
      if (pending) {
        pending.status = status;
      } else {
        result.push({ id: idCounter++, kind: "tool", label, status });
      }
      continue;
    }

    const subagentCallMatch = line.match(/^\[子代理\] 运行 (.+)$/);
    if (subagentCallMatch) {
      result.push({ id: idCounter++, kind: "subagent", label: subagentCallMatch[1], status: "calling" });
      continue;
    }

    const subagentDoneMatch = line.match(/^\[子代理\] (.+) (完成，主 agent 正在检查返回值|失败)$/);
    if (subagentDoneMatch) {
      const label = subagentDoneMatch[1];
      const status = subagentDoneMatch[2].startsWith("完成") ? "done" : "failed";
      const pending = result.find(
        (e): e is ToolCallEntry => e.kind === "subagent" && e.label === label && e.status === "calling"
      );
      if (pending) {
        pending.status = status;
      } else {
        result.push({ id: idCounter++, kind: "subagent", label, status });
      }
      continue;
    }

    result.push({ kind: "text", text: line });
  }

  return collapseRepeatedThinkingLines(result);
}

function collapseRepeatedThinkingLines(lines: ThinkingLine[]): ThinkingLine[] {
  const collapsed: ThinkingLine[] = [];

  for (const line of lines) {
    const previous = collapsed[collapsed.length - 1];
    if (
      previous &&
      previous.kind !== "text" &&
      line.kind !== "text" &&
      previous.kind === line.kind &&
      previous.label === line.label
    ) {
      previous.count = (previous.count ?? 1) + 1;
      previous.status = line.status;
      continue;
    }

    collapsed.push(line);
  }

  return collapsed;
}

function ThinkingTextLines({ text }: { text: string }) {
  const lines = parseThinkingLines(text);
  return (
    <ul className="artifact-workspace__thinking-lines">
      {lines.map((line, index) => {
        if (line.kind === "tool" || line.kind === "subagent") {
          return (
            <li
              key={line.id}
              className={`artifact-workspace__thinking-tool artifact-workspace__thinking-tool--${line.status}`}
            >
              {line.status === "done" ? (
                <Check aria-hidden="true" size={12} />
              ) : line.status === "failed" ? (
                <span aria-hidden="true" className="artifact-workspace__thinking-x">✕</span>
              ) : (
                <span aria-hidden="true" className="artifact-workspace__thinking-spinner" />
              )}
              <span>
                {line.kind === "subagent" ? `[子代理] ${line.label}` : line.label}
                {line.count && line.count > 1 ? ` x ${line.count}` : ""}
              </span>
            </li>
          );
        }
        const textLine = line as OtherLine;
        return (
          <li key={index} className="artifact-workspace__thinking-text">
            {textLine.text}
          </li>
        );
      })}
    </ul>
  );
}

function previousArtifactForRenderer(selectedArtifact: Artifact, artifacts: Artifact[], currentNode: TreeNode | null) {
  const sourceIds = [
    ...(selectedArtifact.sourceArtifactIds ?? []),
    ...(currentNode?.sourceArtifactIds ?? [])
  ].filter((sourceId, index, all) => sourceId !== selectedArtifact.id && all.indexOf(sourceId) === index);

  for (const sourceId of sourceIds) {
    const sourceArtifact = artifacts.find((artifact) => artifact.id === sourceId);
    if (sourceArtifact && sourceArtifact.type === selectedArtifact.type) return sourceArtifact;
  }

  return null;
}

function ProcessMaterials({ isStreaming, materials }: { isStreaming: boolean; materials: ProcessMaterial[] }) {
  const totalItemCount = materials.reduce((count, material) => count + material.items.length, 0);

  return (
    <section
      className={`artifact-workspace__materials${
        isStreaming ? " artifact-workspace__materials--streaming artifact-workspace__materials--generating" : ""
      }`}
      aria-labelledby="artifact-workspace-materials-title"
    >
      <div className="artifact-workspace__materials-header">
        <h3 id="artifact-workspace-materials-title">过程材料</h3>
        <span>{totalItemCount > 0 ? `${totalItemCount} 条` : `${materials.length} 个工具结果`}</span>
      </div>
      <div className="artifact-workspace__materials-list">
        {materials.map((material, index) => (
          <article className="artifact-workspace__material" key={`${material.title}-${index}`}>
            <header className="artifact-workspace__material-header">
              <h4>{material.title}</h4>
              {material.sourceToolCallIds.length > 0 ? <span>{material.sourceToolCallIds.length} 个来源</span> : null}
            </header>
            {material.note ? <p className="artifact-workspace__material-note">{material.note}</p> : null}
            <ol className="artifact-workspace__material-items">
              {material.items.map((item, itemIndex) => (
                <li className="artifact-workspace__material-item" key={`${item.title}-${itemIndex}`}>
                  <div className="artifact-workspace__material-item-title">
                    <ProcessMaterialItemTitle item={item} />
                  </div>
                  {item.subtitle ? <p>{item.subtitle}</p> : null}
                  {item.meta ? <span>{item.meta}</span> : null}
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProcessMaterialItemTitle({ item }: { item: ProcessMaterialItem }) {
  const urls = item.urls && item.urls.length > 0 ? item.urls : item.url ? [item.url] : [];

  if (urls.length === 0) return item.title;

  if (urls.length === 1) {
    return (
      <a
        aria-label={`${item.title} 来源`}
        className="artifact-workspace__material-link"
        href={urls[0]}
        rel="noreferrer"
        target="_blank"
      >
        <span>{item.title}</span>
        <span className="artifact-workspace__material-link-source">
          来源
          <ExternalLink aria-hidden="true" size={12} strokeWidth={2.2} />
        </span>
      </a>
    );
  }

  return (
    <>
      <span className="artifact-workspace__material-title-text">{item.title}</span>
      <span className="artifact-workspace__material-link-list">
        {urls.map((sourceUrl, sourceIndex) => (
          <a
            aria-label={`${item.title} 来源 ${sourceIndex + 1}`}
            className="artifact-workspace__material-link-source"
            href={sourceUrl}
            key={`${sourceUrl}-${sourceIndex}`}
            rel="noreferrer"
            target="_blank"
          >
            来源 {sourceIndex + 1}
            <ExternalLink aria-hidden="true" size={12} strokeWidth={2.2} />
          </a>
        ))}
      </span>
    </>
  );
}

function ArtifactComparisonView({
  comparisonArtifacts,
  comparisonLabels,
  comparisonSelectionCount,
  isBusy
}: {
  comparisonArtifacts: { from: Artifact; to: Artifact } | null;
  comparisonLabels: { from: string; to: string } | null;
  comparisonSelectionCount: number;
  isBusy: boolean;
}) {
  if (!comparisonArtifacts) {
    return (
      <div className="artifact-comparison__status" role="status">
        {comparisonSelectionCount === 1 ? "继续选择另一个节点" : "点选两个节点开始对比"}
      </div>
    );
  }

  return (
    <div className="artifact-comparison">
      {comparisonLabels ? (
        <div className="artifact-comparison__status" role="status">
          {comparisonLabels.from}
          {" -> "}
          {comparisonLabels.to}
        </div>
      ) : null}
      <div className="artifact-comparison__grid">
        <section className="artifact-comparison__pane">
          <h3>{comparisonLabels?.from ?? "起点"}</h3>
          <ArtifactPreview artifact={comparisonArtifacts.from} isBusy={isBusy} />
        </section>
        <section className="artifact-comparison__pane">
          <h3>{comparisonLabels?.to ?? "终点"}</h3>
          <ArtifactPreview artifact={comparisonArtifacts.to} isBusy={isBusy} />
        </section>
      </div>
    </div>
  );
}

function ArtifactPreview({ artifact, isBusy }: { artifact: Artifact; isBusy: boolean }) {
  const manifest = getArtifactClientManifest(artifact.type);
  const Renderer = manifest ? getArtifactRenderer(manifest.rendererKey) : null;

  return Renderer ? <Renderer artifact={artifact} isBusy={isBusy} /> : <ArtifactFallback artifact={artifact} />;
}

function processMaterialsForNode(node: TreeNode | null): ProcessMaterial[] {
  if (!node) return [];

  const seen = new Set<string>();
  const materials: ProcessMaterial[] = [];

  for (const message of node.agentMessages) {
    for (const part of structuredParts(message.content)) {
      const material = processMaterialFromToolPart(part);
      if (!material) continue;

      const key = JSON.stringify(material);
      if (seen.has(key)) continue;

      seen.add(key);
      materials.push(material);
      if (materials.length >= 6) return materials;
    }
  }

  return materials;
}

function processMaterialFromToolPart(part: unknown): ProcessMaterial | null {
  const value = processDataToolValueFromPart(part);
  return value === undefined ? null : processMaterialFromValue(unwrapToolOutput(value));
}

function processDataToolValueFromPart(part: unknown): unknown {
  if (!isRecord(part)) return undefined;

  const toolName = stringField(part, "toolName") ?? stringField(part, "name") ?? stringField(part, "tool");
  if (toolName !== SHOW_PROCESS_DATA_TOOL_NAME) return undefined;

  const type = stringField(part, "type");
  if (
    type?.includes("tool-result") ||
    Object.prototype.hasOwnProperty.call(part, "output") ||
    Object.prototype.hasOwnProperty.call(part, "result")
  ) {
    return Object.prototype.hasOwnProperty.call(part, "output") ? part.output : part.result;
  }

  if (
    type?.includes("tool-call") ||
    Object.prototype.hasOwnProperty.call(part, "input") ||
    Object.prototype.hasOwnProperty.call(part, "args")
  ) {
    return Object.prototype.hasOwnProperty.call(part, "input") ? part.input : part.args;
  }

  return undefined;
}

function structuredParts(content: TreeNode["agentMessages"][number]["content"]): unknown[] {
  return Array.isArray(content) ? content : [content];
}

function unwrapToolOutput(output: unknown): unknown {
  if (!isRecord(output)) return output;

  const type = stringField(output, "type");
  if (type === "json" && Object.prototype.hasOwnProperty.call(output, "value")) {
    return output.value;
  }

  return output;
}

function processMaterialFromValue(value: unknown): ProcessMaterial | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = stringField(value, "title");
  if (!title) return null;

  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items = rawItems.map(processMaterialItemFromValue).filter((item): item is ProcessMaterialItem => Boolean(item));
  if (items.length === 0) return null;

  return {
    items,
    note: stringField(value, "note"),
    sourceToolCallIds: stringArrayField(value, "sourceToolCallIds"),
    title
  };
}

function processMaterialItemFromValue(value: unknown): ProcessMaterialItem | null {
  if (!isRecord(value)) return null;

  const title = stringField(value, "title");
  if (!title) return null;
  const url = stringField(value, "url") ?? stringField(value, "source_url") ?? stringField(value, "sourceUrl");
  const urls = nonEmptyStringArrayField(value, "urls")
    ?? nonEmptyStringArrayField(value, "source_urls")
    ?? nonEmptyStringArrayField(value, "sourceUrls")
    ?? (url ? [url] : []);
  const normalizedUrl = urls[0] ?? url;

  return {
    title,
    ...(stringField(value, "subtitle") ? { subtitle: stringField(value, "subtitle") } : {}),
    ...(stringField(value, "meta") ? { meta: stringField(value, "meta") } : {}),
    ...(normalizedUrl ? { url: normalizedUrl } : {}),
    ...(urls.length > 0 ? { urls } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string) {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayField(record: Record<string, unknown>, field: string) {
  const value = record[field];
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
}

function nonEmptyStringArrayField(record: Record<string, unknown>, field: string) {
  const strings = stringArrayField(record, field);
  return strings.length > 0 ? strings : undefined;
}

import clsx from "clsx";
import { CheckCircle2, Plus, RefreshCw, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  CUSTOM_OPTION_ID_PREFIX,
  PRIMARY_BRANCH_OPTION_IDS,
  isCustomBranchOptionId,
  isPrimaryBranchOptionId,
  type BranchOption,
  type CustomBranchOptionId,
  type OptionGenerationMode,
  type Skill
} from "@/lib/domain";
import { orderBranchOptions } from "./graph";

function displayBranchLabel(label: string) {
  return (
    label
      .replace(/^\s*(?:扎根|深脉|分叉|根系|分支|方向|Branch)\s*[：:]\s*/i, "")
      .replace(/[“”"'`]/g, "")
      .trim() || "新方向"
  );
}

export function BranchCompletePanel({
  isBusy,
  message,
  onAddCustomOption
}: {
  isBusy: boolean;
  message?: string;
  onAddCustomOption?: (option: BranchOption) => void;
}) {
  const trimmedMessage = message?.trim() || "当前作品已经收束。";

  return (
    <div aria-label="当前路径已完成" className="branch-complete-panel" role="status">
      <div className="branch-complete-panel__status">
        <span className="branch-complete-panel__icon" aria-hidden="true">
          <CheckCircle2 size={16} strokeWidth={2.5} />
        </span>
        <span>已完成</span>
      </div>
      <p className="branch-complete-panel__text">{trimmedMessage}</p>
      {onAddCustomOption ? (
        <MoreDirectionsCard
          buttonClassName="branch-complete-panel__action"
          disabled={isBusy}
          fieldLabel="想继续追问什么？"
          formClassName="branch-side-form branch-side-form--complete"
          headerLabel="继续追问"
          onAddCustomOption={onAddCustomOption}
          placeholder="例如：追问这个结论适用于什么团队边界"
          submitLabel="开始追问"
          textareaLabel="继续追问内容"
          triggerLabel="继续追问"
          triggerTitle="继续追问"
        />
      ) : null}
    </div>
  );
}

export function BranchOptionTray({
  isCustomOptionInline = false,
  isBusy,
  isStreamingOptions = false,
  onAddCustomOption,
  onChoose,
  onRegenerateOptions,
  options,
  optionsHeaderAction,
  pendingChoice,
  question,
  visibleCount = options.length
}: {
  isCustomOptionInline?: boolean;
  isBusy: boolean;
  isStreamingOptions?: boolean;
  onAddCustomOption?: (option: BranchOption) => void;
  onChoose: (optionId: BranchOption["id"], note?: string, optionMode?: OptionGenerationMode) => void;
  onRegenerateOptions?: (optionMode: OptionGenerationMode) => void;
  options: BranchOption[];
  optionsHeaderAction?: ReactNode;
  pendingChoice: string | null;
  question?: string;
  skills?: Skill[];
  visibleCount?: number;
}) {
  const [optionNotes, setOptionNotes] = useState<Partial<Record<BranchOption["id"], string>>>({});
  const [optionMode, setOptionMode] = useState<OptionGenerationMode>("balanced");
  const [selectedOptionId, setSelectedOptionId] = useState<BranchOption["id"] | null>(null);
  const orderedOptions = orderBranchOptions(options);
  const primaryOptions = orderedOptions.filter((option) => isPrimaryBranchOptionId(option.id));
  const visiblePrimaryOptionIds = new Set(primaryOptions.slice(0, Math.max(0, visibleCount)).map((option) => option.id));
  const primaryOptionById = new Map(primaryOptions.map((option) => [option.id, option]));
  const primaryOptionIdsKey = primaryOptions.map((option) => option.id).join("|");
  const hasAllPrimaryOptions = PRIMARY_BRANCH_OPTION_IDS.every((optionId) => primaryOptionById.has(optionId));
  const primaryAllVisible = PRIMARY_BRANCH_OPTION_IDS.every(
    (optionId) => primaryOptionById.has(optionId) && visiblePrimaryOptionIds.has(optionId)
  );
  const canRetryMissingOptions = Boolean(onRegenerateOptions && !isBusy && !hasAllPrimaryOptions);
  const shouldShowOptionMain = primaryOptions.length > 0 || isBusy || isStreamingOptions || !canRetryMissingOptions;
  const trimmedQuestion = question?.trim();
  const selectedOption = selectedOptionId ? primaryOptionById.get(selectedOptionId) ?? null : null;

  useEffect(() => {
    if (selectedOptionId && !primaryOptionIdsKey.split("|").includes(selectedOptionId)) {
      setSelectedOptionId(null);
    }
  }, [primaryOptionIdsKey, selectedOptionId]);

  return (
    <div aria-label="回答当前问题" className="branch-option-tray" role="group">
      {trimmedQuestion || optionsHeaderAction ? (
        <div className={clsx("branch-option-question", optionsHeaderAction && "branch-option-question--with-action")}>
          {optionsHeaderAction ? <div className="branch-option-question__action">{optionsHeaderAction}</div> : null}
          {trimmedQuestion ? (
            <div className="branch-option-question__copy">
              <p className="branch-option-question__eyebrow">当前问题</p>
              <p className="branch-option-question__text">{trimmedQuestion}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {primaryAllVisible ? (
        <div aria-label="方向控制" className="branch-option-tray__controls" role="group">
          <OptionModeControl
            disabled={isBusy}
            mode={optionMode}
            onModeChange={setOptionMode}
            onRegenerateOptions={onRegenerateOptions}
          />
          {isCustomOptionInline || selectedOption ? null : (
            <MoreDirectionsCard disabled={isBusy} onAddCustomOption={onAddCustomOption} />
          )}
        </div>
      ) : null}
      {shouldShowOptionMain ? (
        <div
          aria-label="三个主选项"
          className={clsx(
            "branch-option-main",
            "branch-option-main--horizontal",
            selectedOption && "branch-option-main--selection-active"
          )}
          role="group"
        >
          {PRIMARY_BRANCH_OPTION_IDS.map((optionId) => {
            const option = primaryOptionById.get(optionId);
            return option && visiblePrimaryOptionIds.has(optionId) ? (
              <BranchOptionCard
                isBusy={isBusy || !primaryAllVisible || Boolean(selectedOption)}
                isPending={pendingChoice === option.id}
                isSelected={selectedOption?.id === option.id}
                isStreaming={isStreamingOptions}
                key={option.id}
                onSelect={() => setSelectedOptionId(option.id)}
                option={option}
              />
            ) : (
              <BranchOptionPlaceholder key={optionId} optionId={optionId} />
            );
          })}
        </div>
      ) : null}
      {canRetryMissingOptions ? (
        <div className="branch-option-retry" role="status">
          <span>选项还没生成出来</span>
          <button className="option-mode-refresh" onClick={() => onRegenerateOptions?.(optionMode)} type="button">
            <RefreshCw aria-hidden="true" size={13} strokeWidth={2.4} />
            <span>重试生成选项</span>
          </button>
        </div>
      ) : null}
      {selectedOption && primaryAllVisible ? (
        <div className="branch-option-custom-input branch-option-custom-input--selected">
          <BranchOptionComposer
            isBusy={isBusy}
            note={optionNotes[selectedOption.id] ?? ""}
            onChoose={onChoose}
            onClose={() => setSelectedOptionId(null)}
            onNoteChange={(note) => setOptionNotes((notes) => ({ ...notes, [selectedOption.id]: note }))}
            option={selectedOption}
            optionMode={optionMode}
          />
        </div>
      ) : isCustomOptionInline && primaryAllVisible ? (
        <div className="branch-option-custom-input">
          <MoreDirectionsCard
            defaultEditing
            disabled={isBusy}
            fieldLabel="自己写方向"
            formClassName="branch-side-form branch-side-form--inline branch-side-form--compact"
            headerLabel="自己写方向"
            hideHeaderClose
            isCompactInline
            isPersistent
            onAddCustomOption={onAddCustomOption}
            placeholder="输入你想补充的方向..."
            submitLabel="发送"
            textareaLabel="自己写方向"
          />
        </div>
      ) : null}
    </div>
  );
}

const DIRECTION_RANGE_OPTIONS: Array<{
  description: string;
  label: string;
  value: OptionGenerationMode;
}> = [
  { label: "发散", value: "divergent", description: "拓宽下一轮候选方向" },
  { label: "平衡", value: "balanced", description: "保持适中的候选范围" },
  { label: "专注", value: "focused", description: "收束下一轮候选方向" }
];

function OptionModeControl({
  disabled,
  mode,
  onModeChange,
  onRegenerateOptions
}: {
  disabled: boolean;
  mode: OptionGenerationMode;
  onModeChange: (mode: OptionGenerationMode) => void;
  onRegenerateOptions?: (mode: OptionGenerationMode) => void;
}) {
  function chooseMode(nextMode: OptionGenerationMode) {
    onModeChange(nextMode);
  }

  return (
    <div className="option-mode-control-wrap">
      <span className="option-mode-control__label">发散度</span>
      <div aria-label="发散度" className="option-mode-control" role="group">
        {DIRECTION_RANGE_OPTIONS.map((item) => (
          <button
            aria-label={item.label}
            aria-pressed={mode === item.value}
            className={clsx("option-mode-control__button", mode === item.value && "option-mode-control__button--active")}
            disabled={disabled}
            key={item.value}
            onClick={() => chooseMode(item.value)}
            title={`${item.description}；点重新生成当前选项才会刷新这三个选项`}
            type="button"
          >
            <span className="option-mode-control__button-label">{item.label}</span>
          </button>
        ))}
      </div>
      {onRegenerateOptions ? (
        <button
          aria-label="重新生成当前选项"
          className="option-mode-refresh option-mode-refresh--icon"
          disabled={disabled}
          onClick={() => onRegenerateOptions(mode)}
          title="按当前发散度重新生成这三个选项"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={13} strokeWidth={2.4} />
        </button>
      ) : null}
    </div>
  );
}

function BranchOptionPlaceholder({ optionId }: { optionId: BranchOption["id"] }) {
  return (
    <div className="branch-card branch-card--placeholder">
      <span className="branch-card__header">
        <span className="branch-card__choice">{optionId.toUpperCase()}</span>
        <span className="branch-card__label">等待中</span>
      </span>
    </div>
  );
}

export function BranchOptionButton({
  cardWidth,
  isBusy,
  isPending,
  onChoose,
  option
}: {
  cardWidth?: number;
  isBusy: boolean;
  isPending: boolean;
  onChoose: (optionId: BranchOption["id"]) => void;
  option: BranchOption;
}) {
  const displayLabel = displayBranchLabel(option.label);

  return (
    <button
      aria-label={`${option.id.toUpperCase()} ${displayLabel}${isPending ? " 生成中" : ""}`}
      className={clsx("branch-card", isPending && "branch-card--pending")}
      data-pending={isPending ? "true" : undefined}
      disabled={isBusy}
      onClick={() => onChoose(option.id)}
      style={cardWidth ? { width: cardWidth } : undefined}
      type="button"
    >
      <span className="branch-card__header">
        <span className="branch-card__choice">{option.id.toUpperCase()}</span>
        <span className="branch-card__label">
          {displayLabel}
          {isPending ? " 生成中" : ""}
        </span>
      </span>
    </button>
  );
}

function BranchOptionCard({
  isBusy,
  isPending,
  isSelected,
  isStreaming,
  onSelect,
  option,
  variant = "primary"
}: {
  isBusy: boolean;
  isPending: boolean;
  isSelected?: boolean;
  isStreaming?: boolean;
  onSelect: () => void;
  option: BranchOption;
  variant?: "primary" | "side";
}) {
  const displayLabel = displayBranchLabel(option.label);
  const choiceLabel = isCustomBranchOptionId(option.id) && variant === "side" ? "自定义" : option.id.toUpperCase();

  return (
    <div
      className={clsx(
        "branch-card",
        "branch-card--option",
        variant === "side" && "branch-card--side",
        isSelected && "branch-card--selected",
        isPending && "branch-card--pending",
        isStreaming && "branch-card--streaming"
      )}
    >
      <button
        aria-pressed={isSelected ? "true" : "false"}
        aria-label={`${choiceLabel} ${displayLabel} ${option.description}${isPending ? " 生成中" : ""}`}
        className="branch-card__choose"
        data-pending={isPending ? "true" : undefined}
        data-choice-button="true"
        disabled={isBusy}
        onClick={onSelect}
        type="button"
      >
        <span className="branch-card__header">
          <span className="branch-card__choice">{choiceLabel}</span>
          <span className="branch-card__copy">
            <span className="branch-card__label">
              {displayLabel}
              {isPending ? " 生成中" : ""}
            </span>
            <span className="branch-card__description">{option.description}</span>
          </span>
        </span>
      </button>
    </div>
  );
}

function BranchOptionComposer({
  isBusy,
  note,
  onChoose,
  onClose,
  onNoteChange,
  option,
  optionMode
}: {
  isBusy: boolean;
  note: string;
  onChoose: (optionId: BranchOption["id"], note?: string, optionMode?: OptionGenerationMode) => void;
  onClose: () => void;
  onNoteChange: (note: string) => void;
  option: BranchOption;
  optionMode: OptionGenerationMode;
}) {
  const choiceLabel = option.id.toUpperCase();
  const displayLabel = displayBranchLabel(option.label);
  const trimmedDescription = option.description.trim();
  const trimmedImpact = option.impact.trim();

  return (
    <div aria-label={`${choiceLabel} 写作操作`} className="branch-option-composer branch-option-composer--inline" role="group">
      <div className="branch-option-composer__summary">
        <span className="branch-option-composer__summary-kicker">已选 {choiceLabel}</span>
        <strong className="branch-option-composer__summary-title">{displayLabel}</strong>
        {trimmedDescription ? (
          <p className="branch-option-composer__summary-description">{trimmedDescription}</p>
        ) : null}
        {trimmedImpact ? <p className="branch-option-composer__summary-impact">{trimmedImpact}</p> : null}
      </div>
      <label className="branch-option-composer__note">
        <span>还想补一句吗？</span>
        <textarea
          aria-label={`补充想法 ${choiceLabel}`}
          disabled={isBusy}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="还想补一句吗？"
          rows={3}
          value={note}
        />
      </label>
      <button
        aria-label="关闭写作操作"
        className="branch-option-composer__close"
        disabled={isBusy}
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" size={14} strokeWidth={2.4} />
      </button>
      <button
        aria-label={`${choiceLabel} 按这个方向继续`}
        className="branch-option-composer__submit"
        disabled={isBusy}
        onClick={() => onChoose(option.id, note.trim(), optionMode)}
        type="button"
      >
        按这个方向继续
      </button>
    </div>
  );
}

function MoreDirectionsCard({
  buttonClassName = "branch-side-action",
  defaultEditing = false,
  disabled,
  fieldLabel = "想让它怎么写？",
  formClassName = "branch-side-form",
  headerLabel = "自己写方向",
  hideHeaderClose = false,
  isCompactInline = false,
  isPersistent = false,
  onAddCustomOption,
  placeholder = "例如：从评论区争议切入，语气更像朋友聊天",
  submitLabel = "添加",
  textareaLabel = "自己写方向",
  triggerLabel = "自己写方向",
  triggerTitle = "写一个自己的方向"
}: {
  buttonClassName?: string;
  defaultEditing?: boolean;
  disabled: boolean;
  fieldLabel?: string;
  formClassName?: string;
  headerLabel?: string;
  hideHeaderClose?: boolean;
  isCompactInline?: boolean;
  isPersistent?: boolean;
  onAddCustomOption?: (option: BranchOption) => void;
  placeholder?: string;
  submitLabel?: string;
  textareaLabel?: string;
  triggerLabel?: string;
  triggerTitle?: string;
}) {
  const [isEditing, setIsEditing] = useState(defaultEditing);
  const [content, setContent] = useState("");
  const trimmedContent = content.trim();

  function createCustomBranchOptionId(): CustomBranchOptionId {
    const randomId =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `${CUSTOM_OPTION_ID_PREFIX}${randomId}`;
  }

  if (!isEditing) {
    return (
      <button
        aria-label={triggerLabel}
        className={buttonClassName}
        disabled={disabled}
        onClick={() => setIsEditing(true)}
        title={triggerTitle}
        type="button"
      >
        {buttonClassName === "branch-complete-panel__action" ? <Plus aria-hidden="true" size={13} strokeWidth={2.4} /> : null}
        <span>{triggerLabel}</span>
      </button>
    );
  }

  function closeCustomOption() {
    setIsEditing(false);
    setContent("");
  }

  function addCustomOption() {
    if (!trimmedContent) return;
    onAddCustomOption?.({
      id: createCustomBranchOptionId(),
      label: deriveCustomOptionLabel(trimmedContent),
      description: trimmedContent,
      impact: "按用户自定义方向继续生成。",
      kind: "reframe"
    });
    if (isPersistent) {
      setContent("");
      return;
    }
    closeCustomOption();
  }

  return (
    <div className={formClassName}>
      {isCompactInline ? null : (
        <div className="branch-side-form__header">
          <strong>{headerLabel}</strong>
          {hideHeaderClose ? null : (
            <button aria-label={`关闭${headerLabel}`} disabled={disabled} onClick={closeCustomOption} type="button">
              关闭
            </button>
          )}
        </div>
      )}
      <label className="branch-card__field">
        {isCompactInline ? null : <span>{fieldLabel}</span>}
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
      <button className="branch-card__confirm" disabled={disabled || !trimmedContent} onClick={addCustomOption} type="button">
        {submitLabel}
      </button>
    </div>
  );
}

function deriveCustomOptionLabel(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  const [firstSegment = normalized] = normalized.split(/[。！？!?，,；;：:\n]/);
  const label = firstSegment.trim() || normalized;
  return Array.from(label).slice(0, 15).join("");
}

"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, FileText, Plus, RotateCcw, Trash2 } from "lucide-react";
import { StyleProfileSetup } from "@/components/root-memory/StyleProfileSetup";
import { SkillPicker } from "@/components/skills/SkillPicker";
import {
  DEFAULT_ARTIFACT_TYPE_ID,
  type ArtifactTypeId,
  type CreationRequestOption,
  type Inspiration,
  type RootPreferences,
  type Skill,
  type SkillUpsert
} from "@/lib/domain";
import { type ArtifactType, listArtifactTypes } from "@/lib/artifacts";
import { orderSkillsForDisplay } from "@/lib/skills/skill-order";
import { apiPath } from "@/lib/web-base-path";

const defaultPreferences = {
  domains: ["创作"],
  tones: ["平静"],
  styles: ["观点型"],
  personas: ["实践者"]
} satisfies Omit<RootPreferences, "seed">;

const visibleRequestOptionCount = 6;

type SkillSummaryItem = {
  enabledSkillCount: number;
  id: string;
  title: string;
};

function splitCreationRequest(value: string) {
  return value
    .split(/[，,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatCreationRequest(parts: string[]) {
  return parts.join("，");
}

function summarizeEnabledSkills(selectedSkills: Skill[]): SkillSummaryItem[] {
  const selectedIds = new Set(selectedSkills.map((skill) => skill.id));
  const childCountByParentId = new Map<string, number>();

  for (const skill of selectedSkills) {
    if (!skill.parentSkillId || !selectedIds.has(skill.parentSkillId)) continue;
    childCountByParentId.set(skill.parentSkillId, (childCountByParentId.get(skill.parentSkillId) ?? 0) + 1);
  }

  return selectedSkills
    .filter((skill) => !skill.parentSkillId || !selectedIds.has(skill.parentSkillId))
    .map((skill) => ({
      enabledSkillCount: 1 + (childCountByParentId.get(skill.id) ?? 0),
      id: skill.id,
      title: skill.title
    }));
}

function formatEnabledSkillSummaryCopy(summarySkills: SkillSummaryItem[], selectedSkillCount: number) {
  const groupCount = summarySkills.filter((skill) => skill.enabledSkillCount > 1).length;

  if (groupCount > 0) return `已启用 ${groupCount} 个技能组，${selectedSkillCount} 个技能`;
  return `已启用 ${selectedSkillCount} 个技能`;
}

function formatSkillSummaryTitle(skill: SkillSummaryItem) {
  if (skill.enabledSkillCount <= 1) return skill.title;
  return `${skill.title}（含 ${skill.enabledSkillCount} 个）`;
}

function inspirationAppliesToArtifactType(inspiration: Inspiration, artifactTypeId: ArtifactTypeId) {
  if (inspiration.artifactTypeIds?.length) return inspiration.artifactTypeIds.includes(artifactTypeId);
  if (inspiration.artifactTypeId) return inspiration.artifactTypeId === artifactTypeId;
  return true;
}

export function RootMemorySetup({
  artifactTypes,
  initialArtifactTypeId = DEFAULT_ARTIFACT_TYPE_ID,
  initialSeed = "",
  initialCreationRequest = "",
  initialCreationRequestOptions,
  initialSkillIds,
  inspirations = [],
  onSubmit,
  onArtifactTypeChange,
  isSaving,
  message,
  onBack,
  onManageSkills,
  onCreationRequestOptionsChange,
  onCreateSkill,
  onUpdateSkill,
  styleProfileExternalAvailable,
  skills
}: {
  artifactTypes?: ArtifactType[];
  initialArtifactTypeId?: ArtifactTypeId;
  initialSeed?: string;
  initialCreationRequest?: string;
  initialCreationRequestOptions?: CreationRequestOption[];
  initialSkillIds?: string[];
  inspirations?: Inspiration[];
  onSubmit: (payload: { preferences: RootPreferences; enabledSkillIds: string[] }) => void;
  onArtifactTypeChange?: (artifactTypeId: ArtifactTypeId) => void;
  isSaving: boolean;
  message?: string;
  onBack?: () => void;
  onCreationRequestOptionsChange?: (options: CreationRequestOption[]) => void;
  onCreateSkill?: (input: SkillUpsert) => Promise<Skill | null>;
  onManageSkills: () => void;
  onUpdateSkill?: (skillId: string, input: SkillUpsert) => Promise<Skill | null>;
  styleProfileExternalAvailable?: boolean;
  skills: Skill[];
}) {
  const [artifactTypeId, setArtifactTypeId] = useState<ArtifactTypeId>(initialArtifactTypeId);
  const [seed, setSeed] = useState(initialSeed);
  const [creationRequest, setCreationRequest] = useState(initialCreationRequest);
  const [creationRequestOptions, setCreationRequestOptions] = useState<CreationRequestOption[]>(
    initialCreationRequestOptions ?? []
  );
  const [isManagingRequestOptions, setIsManagingRequestOptions] = useState(false);
  const [areAllRequestOptionsVisible, setAreAllRequestOptionsVisible] = useState(false);
  const [isCustomRequestOpen, setIsCustomRequestOpen] = useState(false);
  const [newRequestOptionLabel, setNewRequestOptionLabel] = useState("");
  const [requestOptionMessage, setRequestOptionMessage] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState(() =>
    initialSkillIds ?? skills.filter((skill) => skill.defaultEnabled && !skill.isArchived).map((skill) => skill.id)
  );
  const [isSkillPickerOpen, setIsSkillPickerOpen] = useState(false);
  const seedFieldId = useId();
  const trimmedSeed = seed.trim();
  const trimmedCreationRequest = creationRequest.trim();
  const canSubmit = trimmedSeed.length > 0;
  const selectedSkills = useMemo(
    () => orderSkillsForDisplay(skills.filter((skill) => selectedSkillIds.includes(skill.id))),
    [selectedSkillIds, skills]
  );
  const summarySkills = useMemo(() => summarizeEnabledSkills(selectedSkills), [selectedSkills]);
  const skillSummaryCopy = formatEnabledSkillSummaryCopy(summarySkills, selectedSkills.length);
  const visibleSummarySkills = summarySkills.slice(0, 3);
  const remainingSkillCount = Math.max(0, summarySkills.length - visibleSummarySkills.length);
  const creationRequestParts = splitCreationRequest(creationRequest);
  const visibleCreationRequestOptions = areAllRequestOptionsVisible
    ? creationRequestOptions
    : creationRequestOptions.slice(0, visibleRequestOptionCount);
  const hiddenRequestOptionCount = Math.max(0, creationRequestOptions.length - visibleCreationRequestOptions.length);
  const availableArtifactTypes = artifactTypes?.length ? artifactTypes : listArtifactTypes();
  const selectedArtifactTypeId = availableArtifactTypes.some((artifactType) => artifactType.id === artifactTypeId)
    ? artifactTypeId
    : availableArtifactTypes[0]?.id ?? DEFAULT_ARTIFACT_TYPE_ID;
  const visibleInspirations = inspirations.filter((inspiration) => inspirationAppliesToArtifactType(inspiration, selectedArtifactTypeId));
  const hasInspirations = visibleInspirations.length > 0;

  useEffect(() => {
    setCreationRequestOptions(initialCreationRequestOptions ?? []);
  }, [initialCreationRequestOptions]);

  useEffect(() => {
    setArtifactTypeId(initialArtifactTypeId);
  }, [initialArtifactTypeId]);

  useEffect(() => {
    if (selectedArtifactTypeId !== artifactTypeId) {
      setArtifactTypeId(selectedArtifactTypeId);
      onArtifactTypeChange?.(selectedArtifactTypeId);
    }
  }, [artifactTypeId, onArtifactTypeChange, selectedArtifactTypeId]);

  function selectArtifactType(nextArtifactTypeId: ArtifactTypeId) {
    setArtifactTypeId(nextArtifactTypeId);
    onArtifactTypeChange?.(nextArtifactTypeId);
  }

  function selectInspiration(inspiration: Inspiration) {
    const nextSeed = inspiration.detail;
    const trimmedNextSeed = nextSeed.trim();
    const shouldConfirm = Boolean(trimmedSeed) && trimmedSeed !== trimmedNextSeed;

    if (shouldConfirm && !window.confirm("当前文本框里已有内容，切换灵感会覆盖它。确定要切换吗？")) return;

    setSeed(nextSeed);
  }

  function toggleCreationRequestOption(option: string) {
    setCreationRequest((current) => {
      const parts = splitCreationRequest(current);
      const nextParts = parts.includes(option) ? parts.filter((part) => part !== option) : [...parts, option];

      return formatCreationRequest(nextParts);
    });
  }

  async function createCreationRequestOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = newRequestOptionLabel.trim();
    if (!label) return;

    setRequestOptionMessage("");

    try {
      const response = await fetch(apiPath("/api/creation-request-options"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label })
      });
      const data = (await response.json()) as { option?: CreationRequestOption; error?: string };
      if (!response.ok || !data.option) throw new Error(data.error ?? "快捷要求保存失败。");
      setCreationRequestOptions((options) => {
        const nextOptions = [...options, data.option!];
        onCreationRequestOptionsChange?.(nextOptions);
        return nextOptions;
      });
      setAreAllRequestOptionsVisible(true);
      setNewRequestOptionLabel("");
    } catch (error) {
      setRequestOptionMessage(error instanceof Error ? error.message : "快捷要求保存失败。");
    }
  }

  async function updateCreationRequestOption(option: CreationRequestOption, nextLabel: string) {
    const label = nextLabel.trim();
    if (!label || label === option.label) return;

    setRequestOptionMessage("");

    try {
      const response = await fetch(apiPath(`/api/creation-request-options/${option.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label })
      });
      const data = (await response.json()) as { option?: CreationRequestOption; error?: string };
      if (!response.ok || !data.option) throw new Error(data.error ?? "快捷要求保存失败。");
      setCreationRequestOptions((options) => {
        const nextOptions = options.map((item) => (item.id === option.id ? data.option! : item));
        onCreationRequestOptionsChange?.(nextOptions);
        return nextOptions;
      });
    } catch (error) {
      setRequestOptionMessage(error instanceof Error ? error.message : "快捷要求保存失败。");
    }
  }

  async function deleteCreationRequestOption(option: CreationRequestOption) {
    setRequestOptionMessage("");

    try {
      const response = await fetch(apiPath(`/api/creation-request-options/${option.id}`), { method: "DELETE" });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "快捷要求删除失败。");
      setCreationRequestOptions((options) => {
        const nextOptions = options.filter((item) => item.id !== option.id);
        onCreationRequestOptionsChange?.(nextOptions);
        return nextOptions;
      });
    } catch (error) {
      setRequestOptionMessage(error instanceof Error ? error.message : "快捷要求删除失败。");
    }
  }

  async function reorderCreationRequestOptions(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= creationRequestOptions.length) return;

    const nextOptions = [...creationRequestOptions];
    const [movedOption] = nextOptions.splice(fromIndex, 1);
    nextOptions.splice(toIndex, 0, movedOption);
    const sortedOptions = nextOptions.map((option, index) => ({ ...option, sortOrder: index }));
    setRequestOptionMessage("");

    try {
      const response = await fetch(apiPath("/api/creation-request-options"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: sortedOptions.map((option) => option.id) })
      });
      const data = (await response.json()) as { options?: CreationRequestOption[]; error?: string };
      if (!response.ok || !data.options) throw new Error(data.error ?? "快捷要求排序失败。");
      setCreationRequestOptions(data.options);
      onCreationRequestOptionsChange?.(data.options);
    } catch (error) {
      setRequestOptionMessage(error instanceof Error ? error.message : "快捷要求排序失败。");
    }
  }

  async function resetCreationRequestOptions() {
    setRequestOptionMessage("");

    try {
      const response = await fetch(apiPath("/api/creation-request-options/reset"), { method: "POST" });
      const data = (await response.json()) as { options?: CreationRequestOption[]; error?: string };
      if (!response.ok || !data.options) throw new Error(data.error ?? "快捷要求重置失败。");
      setCreationRequestOptions(data.options);
      setAreAllRequestOptionsVisible(false);
      onCreationRequestOptionsChange?.(data.options);
    } catch (error) {
      setRequestOptionMessage(error instanceof Error ? error.message : "快捷要求重置失败。");
    }
  }

  function handleSavedStyleSkill(skill: Skill) {
    setSelectedSkillIds((current) => (current.includes(skill.id) ? current : [...current, skill.id]));
  }

  return (
    <main className="root-setup">
      <section className="root-setup__panel">
        <div className="root-setup__topline">
          <p className="eyebrow">创作 Seed</p>
          <div className="root-setup__topline-actions">
            <Link className="secondary-button root-setup__works-link" href="/works">
              <FileText aria-hidden="true" size={16} strokeWidth={2.25} />
              <span>我的作品</span>
            </Link>
            {onBack ? (
              <button className="secondary-button" disabled={isSaving} onClick={onBack} type="button">
                返回当前作品
              </button>
            ) : null}
          </div>
        </div>
        <h1>先写下一个念头。</h1>
        <p className="root-setup__copy">
          可以是一句话、一个观点、一个问题，或者一段还没想清楚的表达。AI 会把它带进树里，并给出第一组三个起始方向。
        </p>
        {message ? (
          <p className="root-setup__error" role="alert">
            {message}
          </p>
        ) : null}
        {availableArtifactTypes.length > 1 ? (
          <section aria-label="作品类型" className="root-setup__artifact-type" role="group">
            <div>
              <p className="eyebrow">作品类型</p>
              <p className="root-setup__request-copy">选择这棵树要生成的产物。</p>
            </div>
            <div className="artifact-type-options">
              {availableArtifactTypes.map((artifactType) => (
                <button
                  aria-label={artifactType.label}
                  aria-pressed={selectedArtifactTypeId === artifactType.id}
                  className={`artifact-type-option${selectedArtifactTypeId === artifactType.id ? " artifact-type-option--active" : ""}`}
                  disabled={isSaving}
                  key={artifactType.id}
                  onClick={() => selectArtifactType(artifactType.id)}
                  type="button"
                >
                  <span>{artifactType.label}</span>
                  <small>{artifactType.description}</small>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <div className="seed-field">
          <div className="seed-field__header">
            <label htmlFor={seedFieldId}>创作 seed</label>
            {onCreateSkill && onUpdateSkill ? (
              <StyleProfileSetup
                disabled={isSaving}
                externalStyleGenerationAvailable={Boolean(styleProfileExternalAvailable)}
                isInline
                onCreateSkill={onCreateSkill}
                onSavedSkill={handleSavedStyleSkill}
                onUpdateSkill={onUpdateSkill}
                selectedSkillIds={selectedSkillIds}
                skills={skills}
              />
            ) : null}
          </div>
          <textarea
            aria-label="创作 seed"
            id={seedFieldId}
            onChange={(event) => setSeed(event.target.value)}
            placeholder="例如：我想写 AI 产品经理在真实项目里的困境"
            rows={5}
            value={seed}
          />
        </div>
        {hasInspirations ? (
          <section aria-label="灵感列表" className="root-setup__inspirations" role="group">
            <p className="eyebrow">灵感</p>
            <div className="inspiration-options">
              {visibleInspirations.map((inspiration) => {
                const isActive = trimmedSeed === inspiration.detail.trim();

                return (
                  <button
                    aria-label={inspiration.title}
                    aria-pressed={isActive}
                    className={`inspiration-option${isActive ? " inspiration-option--active" : ""}`}
                    disabled={isSaving}
                    key={inspiration.id}
                    onClick={() => selectInspiration(inspiration)}
                    type="button"
                  >
                    <span>{inspiration.title}</span>
                    <small>{inspiration.detail}</small>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
        <section aria-label="本次创作要求" className="root-setup__request" role="group">
          <div className="root-setup__request-header">
            <div>
              <p className="eyebrow">本次创作要求</p>
              <p className="root-setup__request-copy">可选。选择这次要处理的具体任务。</p>
            </div>
            <div className="root-setup__request-actions">
              {!isManagingRequestOptions ? (
                <button
                  aria-controls="creation-request-field"
                  aria-expanded={isCustomRequestOpen}
                  aria-label={isCustomRequestOpen ? "收起自定义创作要求" : "展开自定义创作要求"}
                  className={`creation-request-toggle${isCustomRequestOpen ? " creation-request-toggle--active" : ""}`}
                  disabled={isSaving}
                  onClick={() => setIsCustomRequestOpen((isOpen) => !isOpen)}
                  type="button"
                >
                  <Plus aria-hidden="true" size={14} strokeWidth={2.3} />
                  {isCustomRequestOpen ? "收起" : "自定义"}
                </button>
              ) : null}
              <button
                aria-label={isManagingRequestOptions ? "完成管理创作要求快捷按钮" : "管理创作要求快捷按钮"}
                className="secondary-button root-setup__request-manage"
                disabled={isSaving}
                onClick={() => setIsManagingRequestOptions((isManaging) => !isManaging)}
                type="button"
              >
                {isManagingRequestOptions ? "完成" : "管理"}
              </button>
            </div>
          </div>
          {requestOptionMessage ? (
            <p className="root-setup__request-error" role="alert">
              {requestOptionMessage}
            </p>
          ) : null}
          {isManagingRequestOptions ? (
            <div aria-label="管理创作要求快捷按钮" className="request-manager" role="group">
              <div className="request-manager__actions">
                <button
                  aria-label="重置默认快捷要求"
                  className="secondary-button"
                  disabled={isSaving}
                  onClick={() => void resetCreationRequestOptions()}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={16} strokeWidth={2.2} />
                  重置默认
                </button>
              </div>
              <div className="request-manager__list">
                {creationRequestOptions.map((option, index) => (
                  <div className="request-manager__row" key={option.id}>
                    <input
                      aria-label={`编辑快捷要求：${option.label}`}
                      defaultValue={option.label}
                      disabled={isSaving}
                      maxLength={40}
                      onBlur={(event) => void updateCreationRequestOption(option, event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                    <div className="request-manager__row-actions">
                      <button
                        aria-label={`上移快捷要求：${option.label}`}
                        className="icon-button"
                        disabled={isSaving || index === 0}
                        onClick={() => void reorderCreationRequestOptions(index, index - 1)}
                        title={`上移快捷要求：${option.label}`}
                        type="button"
                      >
                        <ArrowUp aria-hidden="true" size={16} strokeWidth={2.2} />
                      </button>
                      <button
                        aria-label={`下移快捷要求：${option.label}`}
                        className="icon-button"
                        disabled={isSaving || index === creationRequestOptions.length - 1}
                        onClick={() => void reorderCreationRequestOptions(index, index + 1)}
                        title={`下移快捷要求：${option.label}`}
                        type="button"
                      >
                        <ArrowDown aria-hidden="true" size={16} strokeWidth={2.2} />
                      </button>
                    </div>
                    <button
                      aria-label={`删除快捷要求：${option.label}`}
                      className="icon-button"
                      disabled={isSaving}
                      onClick={() => void deleteCreationRequestOption(option)}
                      title={`删除快捷要求：${option.label}`}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={16} strokeWidth={2.2} />
                    </button>
                  </div>
                ))}
              </div>
              <form className="request-manager__new" onSubmit={createCreationRequestOption}>
                <input
                  aria-label="新增快捷要求"
                  disabled={isSaving}
                  maxLength={40}
                  onChange={(event) => setNewRequestOptionLabel(event.target.value)}
                  placeholder="新增一个常用要求"
                  value={newRequestOptionLabel}
                />
                <button
                  aria-label="添加快捷要求"
                  className="secondary-button"
                  disabled={isSaving || !newRequestOptionLabel.trim()}
                  type="submit"
                >
                  <Plus aria-hidden="true" size={16} strokeWidth={2.2} />
                  添加
                </button>
              </form>
            </div>
          ) : (
            <>
              <div aria-label="快速选择创作要求" className="request-quick-options" role="group">
                {visibleCreationRequestOptions.map((option) => {
                  const isActive = creationRequestParts.includes(option.label);

                  return (
                    <button
                      aria-pressed={isActive}
                      className={`request-chip${isActive ? " request-chip--active" : ""}`}
                      disabled={isSaving}
                      key={option.id}
                      onClick={() => toggleCreationRequestOption(option.label)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  );
                })}
                {hiddenRequestOptionCount > 0 ? (
                  <button
                    aria-label="展开更多创作要求"
                    className="request-chip request-chip--more"
                    disabled={isSaving}
                    onClick={() => setAreAllRequestOptionsVisible(true)}
                    type="button"
                  >
                    +{hiddenRequestOptionCount}
                  </button>
                ) : areAllRequestOptionsVisible && creationRequestOptions.length > visibleRequestOptionCount ? (
                  <button
                    aria-label="收起更多创作要求"
                    className="request-chip request-chip--more"
                    disabled={isSaving}
                    onClick={() => setAreAllRequestOptionsVisible(false)}
                    type="button"
                  >
                    收起
                  </button>
                ) : null}
              </div>
              {isCustomRequestOpen ? (
                <label className="creation-request-field" id="creation-request-field">
                  <span>自定义创作要求</span>
                  <textarea
                    aria-label="自定义创作要求"
                    disabled={isSaving}
                    maxLength={240}
                    onChange={(event) => setCreationRequest(event.target.value)}
                    placeholder="例如：搜资料，找选题，文案润色"
                    rows={2}
                    value={creationRequest}
                  />
                </label>
              ) : null}
            </>
          )}
        </section>
        <section aria-label="本作品启用技能" className="root-setup__skills">
          <div className="root-setup__skills-header">
            <div>
              <p className="eyebrow">本作品启用技能</p>
              <p className="root-setup__skills-copy">{skillSummaryCopy}</p>
            </div>
            <div className="root-setup__skills-actions">
              {isSkillPickerOpen ? (
                <button className="secondary-button" disabled={isSaving} onClick={onManageSkills} type="button">
                  技能库
                </button>
              ) : null}
              <button
                aria-label={isSkillPickerOpen ? "收起技能列表" : "展开技能列表"}
                aria-expanded={isSkillPickerOpen}
                className="root-setup__skills-toggle"
                disabled={isSaving}
                onClick={() => setIsSkillPickerOpen((open) => !open)}
                type="button"
                title={isSkillPickerOpen ? "收起技能列表" : "展开技能列表"}
              >
                {isSkillPickerOpen ? (
                  <ChevronUp aria-hidden="true" size={18} strokeWidth={2.4} />
                ) : (
                  <ChevronDown aria-hidden="true" size={18} strokeWidth={2.4} />
                )}
              </button>
            </div>
          </div>
          <div aria-label="已启用技能摘要" className="root-setup__skill-summary">
            {selectedSkills.length > 0 ? (
              <div className="root-setup__skill-tags">
                {visibleSummarySkills.map((skill) => (
                  <span key={skill.id}>{formatSkillSummaryTitle(skill)}</span>
                ))}
                {remainingSkillCount > 0 ? (
                  <button
                    className="root-setup__skill-more"
                    disabled={isSaving}
                    onClick={() => setIsSkillPickerOpen(true)}
                    type="button"
                  >
                    还有 {remainingSkillCount} 个
                  </button>
                ) : null}
              </div>
            ) : (
              <span>未启用技能</span>
            )}
          </div>
          {isSkillPickerOpen ? (
            <SkillPicker disabled={isSaving} skills={skills} selectedSkillIds={selectedSkillIds} onChange={setSelectedSkillIds} />
          ) : null}
        </section>
        <button
          className="primary-action"
          disabled={!canSubmit || isSaving}
          onClick={() =>
            onSubmit({
              preferences: {
                ...defaultPreferences,
                artifactTypeId: selectedArtifactTypeId,
                seed: trimmedSeed,
                creationRequest: trimmedCreationRequest
              },
              enabledSkillIds: selectedSkillIds
            })
          }
          type="button"
        >
          {isSaving ? "正在准备..." : "用这个念头开始"}
        </button>
      </section>
    </main>
  );
}

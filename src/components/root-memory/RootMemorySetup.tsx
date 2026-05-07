"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, FileText, Plus, RotateCcw, Trash2 } from "lucide-react";
import { SkillPicker } from "@/components/skills/SkillPicker";
import { DEFAULT_CREATION_REQUEST_OPTIONS, type CreationRequestOption, type RootPreferences, type Skill } from "@/lib/domain";

const defaultPreferences = {
  domains: ["创作"],
  tones: ["平静"],
  styles: ["观点型"],
  personas: ["实践者"]
} satisfies Omit<RootPreferences, "seed">;

const visibleRequestOptionCount = 6;

function splitCreationRequest(value: string) {
  return value
    .split(/[，,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatCreationRequest(parts: string[]) {
  return parts.join("，");
}

function defaultCreationRequestOptions(): CreationRequestOption[] {
  const timestamp = new Date(0).toISOString();

  return DEFAULT_CREATION_REQUEST_OPTIONS.map((option, index) => ({
    ...option,
    sortOrder: index,
    isArchived: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}

export function RootMemorySetup({
  initialSeed = "",
  initialCreationRequest = "",
  initialCreationRequestOptions,
  initialSkillIds,
  onSubmit,
  isSaving,
  message,
  onBack,
  onManageSkills,
  onCreationRequestOptionsChange,
  skills
}: {
  initialSeed?: string;
  initialCreationRequest?: string;
  initialCreationRequestOptions?: CreationRequestOption[];
  initialSkillIds?: string[];
  onSubmit: (payload: { preferences: RootPreferences; enabledSkillIds: string[] }) => void;
  isSaving: boolean;
  message?: string;
  onBack?: () => void;
  onCreationRequestOptionsChange?: (options: CreationRequestOption[]) => void;
  onManageSkills: () => void;
  skills: Skill[];
}) {
  const [seed, setSeed] = useState(initialSeed);
  const [creationRequest, setCreationRequest] = useState(initialCreationRequest);
  const [creationRequestOptions, setCreationRequestOptions] = useState<CreationRequestOption[]>(
    initialCreationRequestOptions ?? defaultCreationRequestOptions()
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
  const trimmedSeed = seed.trim();
  const trimmedCreationRequest = creationRequest.trim();
  const canSubmit = trimmedSeed.length > 0;
  const selectedSkills = useMemo(
    () => skills.filter((skill) => selectedSkillIds.includes(skill.id)),
    [selectedSkillIds, skills]
  );
  const summarySkills = selectedSkills.slice(0, 3);
  const remainingSkillCount = Math.max(0, selectedSkills.length - summarySkills.length);
  const creationRequestParts = splitCreationRequest(creationRequest);
  const visibleCreationRequestOptions = areAllRequestOptionsVisible
    ? creationRequestOptions
    : creationRequestOptions.slice(0, visibleRequestOptionCount);
  const hiddenRequestOptionCount = Math.max(0, creationRequestOptions.length - visibleCreationRequestOptions.length);

  useEffect(() => {
    setCreationRequestOptions(initialCreationRequestOptions ?? defaultCreationRequestOptions());
  }, [initialCreationRequestOptions]);

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
      const response = await fetch("/api/creation-request-options", {
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
      const response = await fetch(`/api/creation-request-options/${option.id}`, {
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
      const response = await fetch(`/api/creation-request-options/${option.id}`, { method: "DELETE" });
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
      const response = await fetch("/api/creation-request-options", {
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
      const response = await fetch("/api/creation-request-options/reset", { method: "POST" });
      const data = (await response.json()) as { options?: CreationRequestOption[]; error?: string };
      if (!response.ok || !data.options) throw new Error(data.error ?? "快捷要求重置失败。");
      setCreationRequestOptions(data.options);
      setAreAllRequestOptionsVisible(false);
      onCreationRequestOptionsChange?.(data.options);
    } catch (error) {
      setRequestOptionMessage(error instanceof Error ? error.message : "快捷要求重置失败。");
    }
  }

  return (
    <main className="root-setup">
      <section className="root-setup__panel">
        <div className="root-setup__topline">
          <p className="eyebrow">创作 Seed</p>
          <div className="root-setup__topline-actions">
            <Link className="secondary-button root-setup__drafts-link" href="/drafts">
              <FileText aria-hidden="true" size={16} strokeWidth={2.25} />
              <span>我的草稿</span>
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
        <label className="seed-field">
          <span>创作 seed</span>
          <textarea
            aria-label="创作 seed"
            onChange={(event) => setSeed(event.target.value)}
            placeholder="例如：我想写 AI 产品经理在真实项目里的困境"
            rows={5}
            value={seed}
          />
        </label>
        <section aria-label="本次创作要求" className="root-setup__request" role="group">
          <div className="root-setup__request-header">
            <div>
              <p className="eyebrow">本次创作要求</p>
              <p className="root-setup__request-copy">可选。指定语言、读者、语气或限制。</p>
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
                    placeholder="例如：保留我的原意，像发给朋友，不要扩写太多"
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
              <p className="root-setup__skills-copy">已启用 {selectedSkills.length} 个技能</p>
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
                className="icon-button"
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
                {summarySkills.map((skill) => (
                  <span key={skill.id}>{skill.title}</span>
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

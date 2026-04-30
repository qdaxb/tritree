"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SkillPicker } from "@/components/skills/SkillPicker";
import type { RootPreferences, Skill } from "@/lib/domain";

const defaultPreferences = {
  domains: ["创作"],
  tones: ["平静"],
  styles: ["观点型"],
  personas: ["实践者"]
} satisfies Omit<RootPreferences, "seed">;

export function RootMemorySetup({
  initialSeed = "",
  initialSkillIds,
  onSubmit,
  isSaving,
  message,
  onBack,
  onManageSkills,
  skills
}: {
  initialSeed?: string;
  initialSkillIds?: string[];
  onSubmit: (payload: { preferences: RootPreferences; enabledSkillIds: string[] }) => void;
  isSaving: boolean;
  message?: string;
  onBack?: () => void;
  onManageSkills: () => void;
  skills: Skill[];
}) {
  const [seed, setSeed] = useState(initialSeed);
  const [selectedSkillIds, setSelectedSkillIds] = useState(() =>
    initialSkillIds ?? skills.filter((skill) => skill.defaultEnabled && !skill.isArchived).map((skill) => skill.id)
  );
  const [isSkillPickerOpen, setIsSkillPickerOpen] = useState(false);
  const trimmedSeed = seed.trim();
  const canSubmit = trimmedSeed.length > 0;
  const selectedSkills = useMemo(
    () => skills.filter((skill) => selectedSkillIds.includes(skill.id)),
    [selectedSkillIds, skills]
  );
  const summarySkills = selectedSkills.slice(0, 3);
  const remainingSkillCount = Math.max(0, selectedSkills.length - summarySkills.length);

  return (
    <main className="root-setup">
      <section className="root-setup__panel">
        <div className="root-setup__topline">
          <p className="eyebrow">创作 Seed</p>
          {onBack ? (
            <button className="secondary-button" disabled={isSaving} onClick={onBack} type="button">
              返回当前作品
            </button>
          ) : null}
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
                seed: trimmedSeed
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

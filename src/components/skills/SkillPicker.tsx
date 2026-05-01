"use client";

import type { Skill } from "@/lib/domain";

const effectGroups = [
  { appliesTo: "writer", title: "写作方式", effect: "影响：草稿" },
  { appliesTo: "editor", title: "审稿重点", effect: "影响：建议" },
  { appliesTo: "both", title: "发布约束", effect: "影响：全程" }
] as const;

export function SkillPicker({
  disabled = false,
  onChange,
  selectedSkillIds,
  skills
}: {
  disabled?: boolean;
  onChange: (skillIds: string[]) => void;
  selectedSkillIds: string[];
  skills: Skill[];
}) {
  const selected = new Set(selectedSkillIds);

  function toggle(skillId: string) {
    const next = new Set(selectedSkillIds);
    if (next.has(skillId)) {
      next.delete(skillId);
    } else {
      next.add(skillId);
    }
    onChange(Array.from(next));
  }

  return (
    <div className="skill-picker">
      {effectGroups.map((group) => {
        const groupSkills = skills.filter((skill) => skill.appliesTo === group.appliesTo);
        if (groupSkills.length === 0) return null;

        return (
          <fieldset aria-label={group.title} className="skill-picker__group" key={group.appliesTo}>
            <legend>{group.title}</legend>
            {groupSkills.map((skill) => (
              <label className="skill-picker__item" key={skill.id}>
                <input
                  checked={selected.has(skill.id)}
                  disabled={disabled}
                  onChange={() => toggle(skill.id)}
                  type="checkbox"
                />
                <span>
                  <strong>{skill.title}</strong>
                  <em className="skill-effect-label">{group.effect}</em>
                  {skill.description ? <small>{skill.description}</small> : null}
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}

"use client";

import type { Skill } from "@/lib/domain";

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
  const categories = Array.from(new Set(skills.map((skill) => skill.category)));

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
      {categories.map((category) => (
        <fieldset aria-label={category} className="skill-picker__group" key={category}>
          <legend>{category}</legend>
          {skills
            .filter((skill) => skill.category === category)
            .map((skill) => (
              <label className="skill-picker__item" key={skill.id}>
                <input
                  checked={selected.has(skill.id)}
                  disabled={disabled}
                  onChange={() => toggle(skill.id)}
                  type="checkbox"
                />
                <span>
                  <strong>{skill.title}</strong>
                  {skill.description ? <small>{skill.description}</small> : null}
                </span>
              </label>
            ))}
        </fieldset>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_SKILL_PROMPT_LENGTH, type Skill, type SkillCategory, type SkillUpsert } from "@/lib/domain";

const categories: SkillCategory[] = ["方向", "约束", "风格", "平台", "检查"];

const emptyForm: SkillUpsert = {
  title: "",
  category: "约束",
  description: "",
  prompt: "",
  appliesTo: "both",
  defaultEnabled: false,
  isArchived: false
};

type EditingState =
  | { mode: "create"; skillId: null }
  | { mode: "edit"; skillId: string }
  | null;

export function SkillLibraryPanel({
  error,
  isSaving,
  onArchive,
  onClose,
  onCreate,
  onImport,
  onUpdate,
  skills
}: {
  error?: string;
  isSaving: boolean;
  onArchive: (skillId: string) => void | Promise<void>;
  onClose: () => void;
  onCreate: (input: SkillUpsert) => boolean | void | Promise<boolean | void>;
  onImport?: (sourceUrl: string) => boolean | void | Promise<boolean | void>;
  onUpdate: (skillId: string, input: SkillUpsert) => boolean | void | Promise<boolean | void>;
  skills: Skill[];
}) {
  const [editing, setEditing] = useState<EditingState>(null);
  const [form, setForm] = useState<SkillUpsert>(emptyForm);
  const [formError, setFormError] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importError, setImportError] = useState("");
  const editorRef = useRef<HTMLElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const groupedSkills = useMemo(() => groupSkills(skills), [skills]);

  useEffect(() => {
    if (!editing) return;
    editorRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    titleInputRef.current?.focus({ preventScroll: true });
  }, [editing]);

  function startCreate() {
    setEditing({ mode: "create", skillId: null });
    setForm(emptyForm);
    setFormError("");
  }

  function startEdit(skill: Skill) {
    if (skill.isSystem) return;
    setEditing({ mode: "edit", skillId: skill.id });
    setForm({
      title: skill.title,
      category: skill.category,
      description: skill.description,
      prompt: skill.prompt,
      appliesTo: skill.appliesTo,
      defaultEnabled: skill.defaultEnabled,
      isArchived: false
    });
    setFormError("");
  }

  async function submitForm() {
    const payload = {
      ...form,
      title: form.title.trim(),
      description: form.description.trim(),
      prompt: form.prompt.trim(),
      isArchived: false
    };
    if (!payload.title || !payload.prompt) {
      setFormError("请填写技能名称和提示词。");
      return;
    }

    setFormError("");
    const result =
      editing?.mode === "edit" ? await onUpdate(editing.skillId, payload) : await onCreate(payload);
    if (result === false) return;

    setEditing(null);
    setForm(emptyForm);
  }

  async function submitImport() {
    const sourceUrl = importUrl.trim();
    if (!sourceUrl) {
      setImportError("请填写 GitHub 仓库 URL。");
      return;
    }

    setImportError("");
    const result = await onImport?.(sourceUrl);
    if (result === false) return;
    setImportUrl("");
  }

  function toggleAppliesTo(target: "writer" | "editor", checked: boolean) {
    setForm((current) => {
      const writer = target === "writer" ? checked : skillAppliesToTarget(current.appliesTo, "writer");
      const editor = target === "editor" ? checked : skillAppliesToTarget(current.appliesTo, "editor");
      if (!writer && !editor) return current;
      return { ...current, appliesTo: appliesToFromTargets({ editor, writer }) };
    });
  }

  return (
    <aside aria-label="技能库" className="skill-library-panel">
      <header className="skill-library-panel__header">
        <div>
          <p className="eyebrow">技能库</p>
          <h2>管理全局技能</h2>
        </div>
        <button aria-label="关闭技能库" disabled={isSaving} onClick={onClose} type="button">
          关闭
        </button>
      </header>

      {error ? (
        <p className="root-setup__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="skill-library-panel__actions">
        <button className="secondary-button" disabled={isSaving} onClick={startCreate} type="button">
          新建技能
        </button>
      </div>

      {onImport ? (
        <section aria-label="导入 Skill 仓库" className="skill-importer">
          <label>
            <span>Skill GitHub URL</span>
            <input
              aria-label="Skill GitHub URL"
              disabled={isSaving}
              onChange={(event) => setImportUrl(event.target.value)}
              placeholder="https://github.com/owner/skill-name"
              value={importUrl}
            />
          </label>
          {importError ? (
            <p className="skill-editor__error" role="alert">
              {importError}
            </p>
          ) : null}
          <button className="secondary-button" disabled={isSaving} onClick={() => void submitImport()} type="button">
            导入
          </button>
        </section>
      ) : null}

      {editing ? (
        <section aria-label={editing.mode === "edit" ? "编辑技能" : "新建技能"} className="skill-editor" ref={editorRef}>
          <label>
            <span>技能名称</span>
            <input
              aria-label="技能名称"
              disabled={isSaving}
              maxLength={40}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              ref={titleInputRef}
              value={form.title}
            />
          </label>
          <label>
            <span>分类</span>
            <select
              aria-label="分类"
              disabled={isSaving}
              onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as SkillCategory }))}
              value={form.category}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <fieldset aria-label="作用方式" className="skill-editor__effect">
            <legend>作用方式</legend>
            <label className="skill-editor__check">
              <input
                checked={skillAppliesToTarget(form.appliesTo, "writer")}
                disabled={isSaving}
                onChange={(event) => toggleAppliesTo("writer", event.target.checked)}
                type="checkbox"
              />
              <span>影响草稿</span>
            </label>
            <label className="skill-editor__check">
              <input
                checked={skillAppliesToTarget(form.appliesTo, "editor")}
                disabled={isSaving}
                onChange={(event) => toggleAppliesTo("editor", event.target.checked)}
                type="checkbox"
              />
              <span>影响建议</span>
            </label>
          </fieldset>
          <label>
            <span>说明（选填）</span>
            <textarea
              aria-label="说明"
              disabled={isSaving}
              maxLength={240}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              rows={2}
              value={form.description}
            />
          </label>
          <label>
            <span>提示词</span>
            <textarea
              aria-label="提示词"
              disabled={isSaving}
              maxLength={MAX_SKILL_PROMPT_LENGTH}
              onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
              rows={5}
              value={form.prompt}
            />
          </label>
          {formError ? (
            <p className="skill-editor__error" role="alert">
              {formError}
            </p>
          ) : null}
          <label className="skill-editor__check">
            <input
              checked={form.defaultEnabled}
              disabled={isSaving}
              onChange={(event) => setForm((current) => ({ ...current, defaultEnabled: event.target.checked }))}
              type="checkbox"
            />
            <span>默认启用</span>
          </label>
          <div className="skill-editor__actions">
            <button disabled={isSaving} onClick={() => setEditing(null)} type="button">
              取消
            </button>
            <button className="primary-action" disabled={isSaving} onClick={() => void submitForm()} type="button">
              保存技能
            </button>
          </div>
        </section>
      ) : null}

      <div className="skill-library-list">
        {groupedSkills.map(([category, categorySkills]) => (
          <section aria-label={category} className="skill-library-group" key={category}>
            <h3>{category}</h3>
            {categorySkills.map((skill) => (
              <article aria-label={skill.title} className="skill-library-item" key={skill.id}>
                <div>
                  <strong>{skill.title}</strong>
                  <span>
                    {skill.isSystem ? "系统" : "用户"}
                    {skill.defaultEnabled ? " · 默认启用" : ""}
                    {" · "}
                    <span>{effectLabelFor(skill.appliesTo)}</span>
                  </span>
                  {skill.description ? <p>{skill.description}</p> : null}
                </div>
                {!skill.isSystem ? (
                  <div className="skill-library-item__actions">
                    <button disabled={isSaving} onClick={() => startEdit(skill)} type="button" aria-label={`编辑 ${skill.title}`}>
                      编辑
                    </button>
                    <button disabled={isSaving} onClick={() => void onArchive(skill.id)} type="button" aria-label={`归档 ${skill.title}`}>
                      归档
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}

function effectLabelFor(appliesTo: Skill["appliesTo"]) {
  if (appliesTo === "writer") return "影响：草稿";
  if (appliesTo === "editor") return "影响：建议";
  return "影响：草稿、建议";
}

function groupSkills(skills: Skill[]) {
  const groups = [
    ["影响草稿", "writer"],
    ["影响建议", "editor"],
    ["影响草稿和建议", "both"]
  ] as const;

  return groups
    .map(([label, appliesTo]) => [label, skills.filter((skill) => skill.appliesTo === appliesTo)] as const)
    .filter(([, groupSkills]) => groupSkills.length > 0);
}

function skillAppliesToTarget(appliesTo: SkillUpsert["appliesTo"], target: "writer" | "editor") {
  return appliesTo === "both" || appliesTo === target;
}

function appliesToFromTargets({
  editor,
  writer
}: {
  editor: boolean;
  writer: boolean;
}): SkillUpsert["appliesTo"] {
  if (writer && editor) return "both";
  return writer ? "writer" : "editor";
}

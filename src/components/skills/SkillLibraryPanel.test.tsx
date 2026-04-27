import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillLibraryPanel } from "./SkillLibraryPanel";
import type { Skill } from "@/lib/domain";

const skills: Skill[] = [
  {
    id: "system-analysis",
    title: "分析",
    category: "方向",
    description: "拆解问题。",
    prompt: "分析 prompt",
    isSystem: true,
    defaultEnabled: true,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  },
  {
    id: "user-constraint",
    title: "我的约束",
    category: "约束",
    description: "保持克制。",
    prompt: "不要夸张。",
    isSystem: false,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  }
];

describe("SkillLibraryPanel", () => {
  it("creates a user skill", async () => {
    const onCreate = vi.fn();
    render(
      <SkillLibraryPanel
        isSaving={false}
        onArchive={vi.fn()}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        skills={skills}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "新建技能" }));
    await userEvent.type(screen.getByRole("textbox", { name: "技能名称" }), "小红书风格");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "分类" }), "平台");
    await userEvent.type(screen.getByRole("textbox", { name: "说明" }), "适合小红书。");
    await userEvent.type(screen.getByRole("textbox", { name: "提示词" }), "标题口语一点。");
    await userEvent.click(screen.getByRole("checkbox", { name: "默认启用" }));
    await userEvent.click(screen.getByRole("button", { name: "保存技能" }));

    expect(onCreate).toHaveBeenCalledWith({
      title: "小红书风格",
      category: "平台",
      description: "适合小红书。",
      prompt: "标题口语一点。",
      defaultEnabled: true,
      isArchived: false
    });
  });

  it("creates a skill when the optional description is blank", async () => {
    const onCreate = vi.fn();
    render(
      <SkillLibraryPanel
        isSaving={false}
        onArchive={vi.fn()}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        skills={skills}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "新建技能" }));
    await userEvent.type(screen.getByRole("textbox", { name: "技能名称" }), "短句约束");
    await userEvent.type(screen.getByRole("textbox", { name: "提示词" }), "句子短一点。");
    await userEvent.click(screen.getByRole("button", { name: "保存技能" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "短句约束",
        description: "",
        prompt: "句子短一点。"
      })
    );
  });

  it("shows validation when required fields are missing", async () => {
    const onCreate = vi.fn();
    render(
      <SkillLibraryPanel
        isSaving={false}
        onArchive={vi.fn()}
        onClose={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        skills={skills}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "新建技能" }));
    await userEvent.click(screen.getByRole("button", { name: "保存技能" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请填写技能名称和提示词。");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("edits and archives user skills while keeping system skills read-only", async () => {
    const onArchive = vi.fn();
    const onUpdate = vi.fn();
    render(
      <SkillLibraryPanel
        isSaving={false}
        onArchive={onArchive}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        skills={skills}
      />
    );

    const systemItem = screen.getByRole("article", { name: "分析" });
    expect(within(systemItem).queryByRole("button", { name: "编辑 分析" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "编辑 我的约束" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "技能名称" }));
    await userEvent.type(screen.getByRole("textbox", { name: "技能名称" }), "克制表达");
    await userEvent.click(screen.getByRole("button", { name: "保存技能" }));

    expect(onUpdate).toHaveBeenCalledWith(
      "user-constraint",
      expect.objectContaining({
        title: "克制表达",
        category: "约束"
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "归档 我的约束" }));

    expect(onArchive).toHaveBeenCalledWith("user-constraint");
  });
});

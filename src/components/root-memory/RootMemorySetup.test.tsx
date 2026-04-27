import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RootMemorySetup } from "./RootMemorySetup";
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
    id: "system-no-hype-title",
    title: "标题不要夸张",
    category: "约束",
    description: "避免标题党。",
    prompt: "约束 prompt",
    isSystem: true,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  }
];

describe("RootMemorySetup", () => {
  it("asks the user for a creation seed before starting", () => {
    render(<RootMemorySetup onManageSkills={vi.fn()} onSubmit={vi.fn()} isSaving={false} skills={skills} />);

    expect(screen.getByRole("textbox", { name: "创作 seed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "技能库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "第一轮引导方向" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择分析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择续写" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择润色" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用这个念头开始" })).toBeDisabled();
  });

  it("submits the seed without requiring a first guide", async () => {
    const onSubmit = vi.fn();
    render(<RootMemorySetup onManageSkills={vi.fn()} onSubmit={onSubmit} isSaving={false} skills={skills} />);

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "我想写 AI 产品经理的真实困境");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ seed: "我想写 AI 产品经理的真实困境" }),
      enabledSkillIds: ["system-analysis"]
    });
  });

  it("can start with the current seed and selected skills already filled in", async () => {
    const onSubmit = vi.fn();
    render(
      <RootMemorySetup
        initialSeed="继续写当前这个念头"
        initialSkillIds={["system-no-hype-title"]}
        onManageSkills={vi.fn()}
        onSubmit={onSubmit}
        isSaving={false}
        skills={skills}
      />
    );

    expect(screen.getByRole("textbox", { name: "创作 seed" })).toHaveValue("继续写当前这个念头");
    expect(screen.getByText("已启用 1 个技能")).toBeInTheDocument();
    expect(screen.getByText("标题不要夸张")).toBeInTheDocument();
    expect(screen.queryByText("分析")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ seed: "继续写当前这个念头" }),
      enabledSkillIds: ["system-no-hype-title"]
    });
  });

  it("keeps the skill list collapsed until the user adjusts skills", async () => {
    render(<RootMemorySetup onManageSkills={vi.fn()} onSubmit={vi.fn()} isSaving={false} skills={skills} />);

    expect(screen.getByText("已启用 1 个技能")).toBeInTheDocument();
    expect(screen.getByText("分析")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "方向" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "技能库" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开技能列表" }));

    expect(screen.getByRole("group", { name: "方向" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "技能库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起技能列表" })).toBeInTheDocument();
  });

  it("expands the skill list from the remaining skill count", async () => {
    const manyDefaultSkills: Skill[] = [
      ...skills,
      {
        ...skills[0],
        id: "system-expand",
        title: "扩写",
        defaultEnabled: true
      },
      {
        ...skills[0],
        id: "system-polish",
        title: "润色",
        defaultEnabled: true
      },
      {
        ...skills[0],
        id: "system-style",
        title: "换风格",
        defaultEnabled: true
      }
    ];
    render(<RootMemorySetup onManageSkills={vi.fn()} onSubmit={vi.fn()} isSaving={false} skills={manyDefaultSkills} />);

    await userEvent.click(screen.getByRole("button", { name: "还有 1 个" }));

    expect(screen.getByRole("group", { name: "方向" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "技能库" })).toBeInTheDocument();
  });

  it("disables submit while saving", async () => {
    render(<RootMemorySetup onManageSkills={vi.fn()} onSubmit={vi.fn()} isSaving skills={skills} />);

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "一个内容念头");

    expect(screen.getByRole("button", { name: "正在准备..." })).toBeDisabled();
  });

  it("shows setup save failures", () => {
    render(<RootMemorySetup message="Seed 保存失败。" onManageSkills={vi.fn()} onSubmit={vi.fn()} isSaving={false} skills={skills} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Seed 保存失败。");
  });

  it("opens the global skill library from the seed screen", async () => {
    const onManageSkills = vi.fn();
    render(<RootMemorySetup onManageSkills={onManageSkills} onSubmit={vi.fn()} isSaving={false} skills={skills} />);

    const skillArea = screen.getByRole("region", { name: "本作品启用技能" });
    await userEvent.click(within(skillArea).getByRole("button", { name: "展开技能列表" }));
    await userEvent.click(within(skillArea).getByRole("button", { name: "技能库" }));

    expect(onManageSkills).toHaveBeenCalled();
  });
});

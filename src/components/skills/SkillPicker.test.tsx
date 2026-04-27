import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillPicker } from "./SkillPicker";
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

describe("SkillPicker", () => {
  it("groups skills and toggles selected ids", async () => {
    const onChange = vi.fn();
    render(<SkillPicker skills={skills} selectedSkillIds={["system-analysis"]} onChange={onChange} />);

    expect(screen.getByRole("group", { name: "方向" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "方向" })).getByRole("checkbox", { name: /分析/ })).toBeChecked();

    await userEvent.click(screen.getByRole("checkbox", { name: /标题不要夸张/ }));

    expect(onChange).toHaveBeenCalledWith(["system-analysis", "system-no-hype-title"]);
  });
});

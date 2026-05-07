import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RootMemorySetup } from "./RootMemorySetup";
import { DEFAULT_CREATION_REQUEST_OPTIONS, type CreationRequestOption, type Skill } from "@/lib/domain";

const skills: Skill[] = [
  {
    id: "system-analysis",
    title: "分析",
    category: "方向",
    description: "拆解问题。",
    prompt: "分析 prompt",
    appliesTo: "editor",
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
    appliesTo: "both",
    isSystem: true,
    defaultEnabled: false,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  }
];

function requestOption(option: { id: string; label: string }, sortOrder = 0): CreationRequestOption {
  return {
    id: option.id,
    label: option.label,
    sortOrder,
    isArchived: false,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z"
  };
}

const defaultRequestOptions = DEFAULT_CREATION_REQUEST_OPTIONS.map((option, index) => requestOption(option, index));

function renderRootMemorySetup(props: Partial<ComponentProps<typeof RootMemorySetup>> = {}) {
  return render(
    <RootMemorySetup
      initialCreationRequestOptions={defaultRequestOptions}
      onManageSkills={vi.fn()}
      onSubmit={vi.fn()}
      isSaving={false}
      skills={skills}
      {...props}
    />
  );
}

describe("RootMemorySetup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the user for a creation seed before starting", () => {
    renderRootMemorySetup();

    expect(screen.getByRole("textbox", { name: "创作 seed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "技能库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "第一轮引导方向" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择分析" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择续写" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择润色" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用这个念头开始" })).toBeDisabled();
  });

  it("links to draft management from the seed screen", () => {
    renderRootMemorySetup();

    expect(screen.getByRole("link", { name: "我的草稿" })).toHaveAttribute("href", "/drafts");
  });

  it("submits the seed without requiring a first guide", async () => {
    const onSubmit = vi.fn();
    renderRootMemorySetup({ onSubmit });

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "我想写 AI 产品经理的真实困境");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ seed: "我想写 AI 产品经理的真实困境" }),
      enabledSkillIds: ["system-analysis"]
    });
  });

  it("lets the user submit an optional creation request", async () => {
    const onSubmit = vi.fn();
    renderRootMemorySetup({ onSubmit });

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "我想写 AI 产品经理的真实困境");
    await userEvent.click(screen.getByRole("button", { name: "展开更多创作要求" }));
    await userEvent.click(screen.getByRole("button", { name: "改成英文" }));
    await userEvent.click(screen.getByRole("button", { name: "像发给朋友" }));
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(screen.getByRole("group", { name: "本次创作要求" })).toBeInTheDocument();
    expect(screen.getByText("可选。指定语言、读者、语气或限制。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "改成英文" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("textbox", { name: "自定义创作要求" })).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        seed: "我想写 AI 产品经理的真实困境",
        creationRequest: "改成英文，像发给朋友"
      }),
      enabledSkillIds: ["system-analysis"]
    });
  });

  it("shows a curated set of quick creation requests", () => {
    renderRootMemorySetup();

    const quickRequests = within(screen.getByRole("group", { name: "快速选择创作要求" }));

    expect(quickRequests.getAllByRole("button", { pressed: false }).map((button) => button.textContent)).toEqual(
      defaultRequestOptions.slice(0, 6).map((option) => option.label)
    );
    expect(screen.getByRole("button", { name: "展开更多创作要求" })).toHaveTextContent("+3");
    expect(quickRequests.queryByRole("button", { name: "展开自定义创作要求" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开自定义创作要求" })).toHaveClass("creation-request-toggle");
  });

  it("keeps the custom request textarea collapsed until needed", async () => {
    renderRootMemorySetup();

    expect(screen.queryByRole("textbox", { name: "自定义创作要求" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开自定义创作要求" }));

    expect(screen.getByRole("textbox", { name: "自定义创作要求" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起自定义创作要求" })).toBeInTheDocument();
  });

  it("keeps the custom request textarea collapsed when quick requests are combined", async () => {
    const onSubmit = vi.fn();
    renderRootMemorySetup({ onSubmit });

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "我想写 AI 产品经理的真实困境");
    await userEvent.click(screen.getByRole("button", { name: "展开更多创作要求" }));
    await userEvent.click(screen.getByRole("button", { name: "改成英文" }));
    await userEvent.click(screen.getByRole("button", { name: "像发给朋友" }));

    expect(screen.queryByRole("textbox", { name: "自定义创作要求" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        seed: "我想写 AI 产品经理的真实困境",
        creationRequest: "改成英文，像发给朋友"
      }),
      enabledSkillIds: ["system-analysis"]
    });
  });

  it("keeps extra quick creation requests collapsed until the user asks for more", async () => {
    renderRootMemorySetup();

    expect(screen.queryByRole("button", { name: "改成英文" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开更多创作要求" }));

    expect(
      within(screen.getByRole("group", { name: "快速选择创作要求" }))
        .getAllByRole("button", { pressed: false })
        .map((button) => button.textContent)
    ).toEqual([
      "保留我的原意",
      "不要扩写太多",
      "适合发微博",
      "先给短版",
      "写给新手",
      "别太像广告",
      "像发给朋友",
      "写给懂行的人",
      "改成英文"
    ]);
    expect(screen.getByRole("button", { name: "收起更多创作要求" })).toBeInTheDocument();
  });

  it("lets the user sort and reset quick creation request buttons", async () => {
    const movedOptions = [
      { ...defaultRequestOptions[1], sortOrder: 0 },
      { ...defaultRequestOptions[0], sortOrder: 1 },
      ...defaultRequestOptions.slice(2)
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ options: movedOptions }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ options: defaultRequestOptions }) });
    vi.stubGlobal("fetch", fetchMock);

    renderRootMemorySetup();

    await userEvent.click(screen.getByRole("button", { name: "管理创作要求快捷按钮" }));
    await userEvent.click(screen.getByRole("button", { name: "下移快捷要求：保留我的原意" }));
    await userEvent.click(screen.getByRole("button", { name: "完成管理创作要求快捷按钮" }));

    expect(within(screen.getByRole("group", { name: "快速选择创作要求" })).getAllByRole("button")[0]).toHaveTextContent(
      "不要扩写太多"
    );

    await userEvent.click(screen.getByRole("button", { name: "管理创作要求快捷按钮" }));
    await userEvent.click(screen.getByRole("button", { name: "重置默认快捷要求" }));
    await userEvent.click(screen.getByRole("button", { name: "完成管理创作要求快捷按钮" }));

    expect(within(screen.getByRole("group", { name: "快速选择创作要求" })).getAllByRole("button")[0]).toHaveTextContent(
      "保留我的原意"
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/creation-request-options",
      expect.objectContaining({ method: "PUT" })
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      orderedIds: movedOptions.map((option) => option.id)
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/creation-request-options/reset",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("lets the user add, rename, and delete quick creation request buttons", async () => {
    const createdOption = requestOption({ id: "custom-overseas", label: "面向海外游客" }, 9);
    const renamedOption = { ...createdOption, label: "写给第一次来的人" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ option: createdOption }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ option: renamedOption }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    renderRootMemorySetup();

    await userEvent.click(screen.getByRole("button", { name: "管理创作要求快捷按钮" }));
    await userEvent.type(screen.getByRole("textbox", { name: "新增快捷要求" }), "面向海外游客");
    await userEvent.click(screen.getByRole("button", { name: "添加快捷要求" }));
    await userEvent.click(screen.getByRole("button", { name: "完成管理创作要求快捷按钮" }));

    expect(screen.getByRole("button", { name: "面向海外游客" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "管理创作要求快捷按钮" }));
    const customOption = screen.getByRole("textbox", { name: "编辑快捷要求：面向海外游客" });
    await userEvent.clear(customOption);
    await userEvent.type(customOption, "写给第一次来的人");
    await userEvent.tab();
    await userEvent.click(screen.getByRole("button", { name: "完成管理创作要求快捷按钮" }));

    expect(screen.getByRole("button", { name: "写给第一次来的人" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "面向海外游客" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "管理创作要求快捷按钮" }));
    await userEvent.click(screen.getByRole("button", { name: "删除快捷要求：写给第一次来的人" }));
    await userEvent.click(screen.getByRole("button", { name: "完成管理创作要求快捷按钮" }));

    expect(screen.queryByRole("button", { name: "写给第一次来的人" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/creation-request-options",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/creation-request-options/custom-overseas",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/creation-request-options/custom-overseas",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("renders quick request buttons loaded from the backend", () => {
    renderRootMemorySetup({
      initialCreationRequestOptions: [
        requestOption({ id: "db-calm", label: "保持克制" }, 0),
        requestOption({ id: "db-boss", label: "写给老板看" }, 1)
      ]
    });

    expect(screen.getByRole("button", { name: "保持克制" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "写给老板看" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保留我的原意" })).not.toBeInTheDocument();
  });

  it("lets the user submit a fully custom creation request", async () => {
    const onSubmit = vi.fn();
    renderRootMemorySetup({ onSubmit });

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "五一来青岛了");
    await userEvent.click(screen.getByRole("button", { name: "展开自定义创作要求" }));
    await userEvent.type(screen.getByRole("textbox", { name: "自定义创作要求" }), "面向海外游客，保留中文地名");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        seed: "五一来青岛了",
        creationRequest: "面向海外游客，保留中文地名"
      }),
      enabledSkillIds: ["system-analysis"]
    });
  });

  it("lets the user combine quick request choices with custom input", async () => {
    const onSubmit = vi.fn();
    renderRootMemorySetup({ onSubmit });

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "五一来青岛了");
    await userEvent.click(screen.getByRole("button", { name: "展开更多创作要求" }));
    await userEvent.click(screen.getByRole("button", { name: "改成英文" }));
    await userEvent.click(screen.getByRole("button", { name: "展开自定义创作要求" }));
    await userEvent.type(screen.getByRole("textbox", { name: "自定义创作要求" }), "，写给第一次来青岛的人");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        seed: "五一来青岛了",
        creationRequest: "改成英文，写给第一次来青岛的人"
      }),
      enabledSkillIds: ["system-analysis"]
    });
  });

  it("can start with a creation request already filled in", async () => {
    const onSubmit = vi.fn();
    render(
      <RootMemorySetup
        initialCreationRequestOptions={defaultRequestOptions}
        initialSeed="继续写当前这个念头"
        initialCreationRequest="从产品实践者视角写，改成英文的"
        initialSkillIds={["system-no-hype-title"]}
        onManageSkills={vi.fn()}
        onSubmit={onSubmit}
        isSaving={false}
        skills={skills}
      />
    );

    expect(screen.queryByRole("textbox", { name: "自定义创作要求" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "展开自定义创作要求" }));
    expect(screen.getByRole("textbox", { name: "自定义创作要求" })).toHaveValue("从产品实践者视角写，改成英文的");

    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        seed: "继续写当前这个念头",
        creationRequest: "从产品实践者视角写，改成英文的"
      }),
      enabledSkillIds: ["system-no-hype-title"]
    });
  });

  it("limits the optional creation request to the schema length", async () => {
    renderRootMemorySetup();

    await userEvent.click(screen.getByRole("button", { name: "展开自定义创作要求" }));

    expect(screen.getByRole("textbox", { name: "自定义创作要求" })).toHaveAttribute("maxlength", "240");
  });

  it("can start with the current seed and selected skills already filled in", async () => {
    const onSubmit = vi.fn();
    render(
      <RootMemorySetup
        initialCreationRequestOptions={defaultRequestOptions}
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
    renderRootMemorySetup();

    expect(screen.getByText("已启用 1 个技能")).toBeInTheDocument();
    expect(screen.getByText("分析")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "审稿重点" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "技能库" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开技能列表" }));

    expect(screen.getByRole("group", { name: "审稿重点" })).toBeInTheDocument();
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
    renderRootMemorySetup({ skills: manyDefaultSkills });

    await userEvent.click(screen.getByRole("button", { name: "还有 1 个" }));

    expect(screen.getByRole("group", { name: "审稿重点" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "技能库" })).toBeInTheDocument();
  });

  it("disables submit while saving", async () => {
    renderRootMemorySetup({ isSaving: true });

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "一个内容念头");

    expect(screen.getByRole("button", { name: "正在准备..." })).toBeDisabled();
  });

  it("shows setup save failures", () => {
    renderRootMemorySetup({ message: "Seed 保存失败。" });

    expect(screen.getByRole("alert")).toHaveTextContent("Seed 保存失败。");
  });

  it("opens the global skill library from the seed screen", async () => {
    const onManageSkills = vi.fn();
    renderRootMemorySetup({ onManageSkills });

    const skillArea = screen.getByRole("region", { name: "本作品启用技能" });
    await userEvent.click(within(skillArea).getByRole("button", { name: "展开技能列表" }));
    await userEvent.click(within(skillArea).getByRole("button", { name: "技能库" }));

    expect(onManageSkills).toHaveBeenCalled();
  });
});

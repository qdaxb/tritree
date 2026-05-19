import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RootMemorySetup } from "./RootMemorySetup";
import { listArtifactTypes } from "@/lib/artifacts";
import type { CreationRequestOption, Skill, SkillUpsert } from "@/lib/domain";

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

const personalStyleSkill: Skill = {
  id: "style-new",
  title: "我的风格：克制产品随笔",
  category: "风格",
  description: "短句、具体、少夸张。",
  prompt: "保持短句，写具体例子。",
  appliesTo: "writer",
  isSystem: false,
  defaultEnabled: true,
  isArchived: false,
  createdAt: "2026-05-13T00:00:00.000Z",
  updatedAt: "2026-05-13T00:00:00.000Z"
};

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

const defaultRequestOptionSeeds = [
  { id: "default-preserve-my-meaning", label: "保留我的原意" },
  { id: "default-dont-expand-much", label: "不要扩写太多" },
  { id: "default-moments", label: "适合短动态" },
  { id: "default-short-version", label: "先给短版" },
  { id: "default-first-time-reader", label: "写给新手" },
  { id: "default-no-ad-tone", label: "别太像广告" },
  { id: "default-friend-tone", label: "像发给朋友" },
  { id: "default-experienced-reader", label: "写给懂行的人" },
  { id: "default-english", label: "改成英文" }
];

const defaultRequestOptions = defaultRequestOptionSeeds.map((option, index) => requestOption(option, index));

function styleStreamResponse(events: unknown[]) {
  const encoder = new TextEncoder();

  return {
    ok: true,
    headers: new Headers({ "Content-Type": "application/x-ndjson; charset=utf-8" }),
    body: new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
        controller.close();
      }
    }),
    json: async () => {
      throw new Error("stream response should not call json");
    }
  };
}

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

function contentTeamSkill(id: string, title: string): Skill {
  const sortOrders = new Map([
    ["system-creator", 0],
    ["system-planner", 1],
    ["system-researcher", 2],
    ["system-writer", 3],
    ["system-reviewer", 4],
    ["system-publisher", 5]
  ]);

  return {
    id,
    title,
    category: "content-team",
    description: `${title}说明。`,
    prompt: `${title} prompt`,
    appliesTo: "both",
    isSystem: true,
    sortOrder: sortOrders.get(id),
    defaultEnabled: true,
    defaultLoaded: id === "system-creator",
    parentSkillId: id === "system-creator" ? null : "system-creator",
    isArchived: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  };
}

describe("RootMemorySetup", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
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

  it("places artifact type selection before the creation seed", () => {
    renderRootMemorySetup();

    const artifactTypeGroup = screen.getByRole("group", { name: "作品类型" });
    const seedField = screen.getByRole("textbox", { name: "创作 seed" });

    expect(artifactTypeGroup.compareDocumentPosition(seedField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("places an unset style setup prompt in the seed field header", async () => {
    const { container } = renderRootMemorySetup({
      onCreateSkill: vi.fn(),
      onUpdateSkill: vi.fn(),
      styleProfileExternalAvailable: false
    });

    const seedField = container.querySelector(".seed-field") as HTMLElement;
    const styleProfile = within(seedField).getByRole("region", { name: "我的风格" });

    expect(seedField).toContainElement(screen.getByRole("textbox", { name: "创作 seed" }));
    expect(styleProfile).toHaveClass("style-profile-setup--inline");
    expect(styleProfile).toHaveClass("style-profile-setup--unset");
    expect(styleProfile).not.toHaveClass("style-profile-setup--expanded");
    expect(within(styleProfile).getByText(/建议先设置/)).toBeInTheDocument();
    expect(within(styleProfile).getByRole("button", { name: "立即设置" })).toBeInTheDocument();

    await userEvent.click(within(styleProfile).getByRole("button", { name: "立即设置" }));

    expect(within(styleProfile).getByRole("button", { name: "粘贴代表作生成" })).toBeInTheDocument();
    expect(within(styleProfile).getByRole("button", { name: "手动填写" })).toBeInTheDocument();
  });

  it("collapses a configured style into a compact seed header block", () => {
    const { container } = renderRootMemorySetup({
      onCreateSkill: vi.fn(),
      onUpdateSkill: vi.fn(),
      skills: [...skills, personalStyleSkill]
    });

    const seedField = container.querySelector(".seed-field") as HTMLElement;
    const styleProfile = within(seedField).getByRole("region", { name: "我的风格" });

    expect(styleProfile).toHaveClass("style-profile-setup--inline");
    expect(styleProfile).toHaveClass("style-profile-setup--set");
    expect(styleProfile).not.toHaveClass("style-profile-setup--expanded");
    expect(within(styleProfile).getByRole("button", { name: "展开我的风格设置：克制产品随笔" })).toHaveClass(
      "style-profile-setup__compact-button"
    );
    expect(within(styleProfile).getByText("克制产品随笔")).toBeInTheDocument();
    expect(within(styleProfile).queryByText("正在使用：我的风格：克制产品随笔")).not.toBeInTheDocument();
    expect(within(styleProfile).queryByRole("button", { name: "更新" })).not.toBeInTheDocument();
    expect(within(styleProfile).queryByRole("button", { name: "粘贴代表作生成" })).not.toBeInTheDocument();
  });

  it("defines a light inline style setup for the seed header", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const inlineRule = css.match(/\.style-profile-setup--inline\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const inlineUnsetRule =
      css.match(/\.style-profile-setup--inline\.style-profile-setup--unset\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const compactButtonRule =
      css.match(/\.style-profile-setup__compact-button\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const seedHeaderRule = css.match(/\.seed-field__header\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const inlineMethodsRule =
      css.match(/\.style-profile-setup--inline \.style-profile-methods\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(seedHeaderRule).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(css).toContain(
      ".seed-field__header > .style-profile-setup--inline.style-profile-setup--unset"
    );
    expect(css).toContain("grid-column: 1 / -1");
    expect(inlineRule).toContain("padding: 8px 10px");
    expect(inlineRule).toContain("box-shadow: none");
    expect(inlineUnsetRule).toContain(
      "background: linear-gradient(135deg, rgba(255, 251, 235, 0.96), rgba(255, 247, 237, 0.92))"
    );
    expect(inlineUnsetRule).toContain("border-color: rgba(217, 119, 6, 0.5)");
    expect(inlineMethodsRule).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(compactButtonRule).toContain("min-height: 28px");
    expect(compactButtonRule).toContain("border-radius: 999px");
  });

  it("links to work management from the seed screen", () => {
    renderRootMemorySetup();

    expect(screen.getByRole("link", { name: "我的作品" })).toHaveAttribute("href", "/works");
  });

  it("keeps the inspiration list hidden when no inspirations are configured", () => {
    renderRootMemorySetup();

    expect(screen.queryByRole("group", { name: "灵感列表" })).not.toBeInTheDocument();
  });

  it("fills the seed from a selected inspiration", async () => {
    renderRootMemorySetup({
      inspirations: [
        {
          id: "idea-1",
          title: "AI 产品真实困境",
          detail: "我想写 AI 产品经理在真实项目里的困境。"
        },
        {
          id: "idea-2",
          title: "团队写作规范",
          detail: "我想写一份团队内容写作规范。"
        }
      ]
    });

    const inspirationList = screen.getByRole("group", { name: "灵感列表" });
    expect(within(inspirationList).getByRole("button", { name: "AI 产品真实困境" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    await userEvent.click(within(inspirationList).getByRole("button", { name: "AI 产品真实困境" }));

    expect(screen.getByRole("textbox", { name: "创作 seed" })).toHaveValue("我想写 AI 产品经理在真实项目里的困境。");
    expect(within(inspirationList).getByRole("button", { name: "AI 产品真实困境" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("confirms before replacing an existing seed with a different inspiration", async () => {
    const confirmMock = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirmMock);

    renderRootMemorySetup({
      inspirations: [
        {
          id: "idea-1",
          title: "AI 产品真实困境",
          detail: "我想写 AI 产品经理在真实项目里的困境。"
        }
      ]
    });

    const seedField = screen.getByRole("textbox", { name: "创作 seed" });
    await userEvent.type(seedField, "我自己的开头");

    await userEvent.click(screen.getByRole("button", { name: "AI 产品真实困境" }));

    expect(confirmMock).toHaveBeenCalledWith("当前文本框里已有内容，切换灵感会覆盖它。确定要切换吗？");
    expect(seedField).toHaveValue("我自己的开头");

    await userEvent.click(screen.getByRole("button", { name: "AI 产品真实困境" }));

    expect(seedField).toHaveValue("我想写 AI 产品经理在真实项目里的困境。");
    expect(confirmMock).toHaveBeenCalledTimes(2);
  });

  it("keeps inspiration cards in a horizontally scrollable row sized for three visible items", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const optionsRule = css.match(/\.inspiration-options\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const optionRule = css.match(/\.inspiration-option\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(optionsRule).toContain("display: flex");
    expect(optionsRule).toContain("overflow-x: auto");
    expect(optionsRule).toContain("scroll-snap-type: x proximity");
    expect(optionRule).toContain("flex: 0 0 calc((100% - 16px) / 3)");
    expect(optionRule).toContain("scroll-snap-align: start");
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

  it("lets the user choose PRD as the artifact type", async () => {
    const onSubmit = vi.fn();
    renderRootMemorySetup({ onSubmit });

    await userEvent.click(screen.getByRole("button", { name: "PRD 文档" }));
    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "移动端作品管理");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(screen.getByRole("group", { name: "作品类型" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "社媒内容" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "PRD 文档" })).toHaveAttribute("aria-pressed", "true");
    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        artifactTypeId: "prd",
        seed: "移动端作品管理"
      }),
      enabledSkillIds: ["system-analysis"]
    });
  });

  it("hides artifact type choices and submits the configured single artifact type", async () => {
    const onSubmit = vi.fn();
    renderRootMemorySetup({
      artifactTypes: listArtifactTypes().filter((artifactType) => artifactType.id === "prd"),
      onSubmit
    });

    expect(screen.queryByRole("group", { name: "作品类型" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "移动端作品管理");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        artifactTypeId: "prd",
        seed: "移动端作品管理"
      }),
      enabledSkillIds: ["system-analysis"]
    });
  });

  it("shows inspirations for the currently selected artifact type", async () => {
    renderRootMemorySetup({
      inspirations: [
        {
          id: "social-idea",
          title: "社媒灵感",
          detail: "写一条社媒内容。",
          artifactTypeIds: ["social-post"]
        },
        {
          id: "prd-idea",
          title: "PRD 灵感",
          detail: "写一份 PRD。",
          artifactTypeIds: ["prd"]
        }
      ]
    });

    expect(screen.getByRole("button", { name: "社媒灵感" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PRD 灵感" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "PRD 文档" }));

    expect(screen.queryByRole("button", { name: "社媒灵感" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PRD 灵感" })).toBeInTheDocument();
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
      "适合短动态",
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

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "周末想写个观察");
    await userEvent.click(screen.getByRole("button", { name: "展开自定义创作要求" }));
    await userEvent.type(screen.getByRole("textbox", { name: "自定义创作要求" }), "面向海外游客，保留中文地名");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        seed: "周末想写个观察",
        creationRequest: "面向海外游客，保留中文地名"
      }),
      enabledSkillIds: ["system-analysis"]
    });
  });

  it("enables a saved personal style skill for the new work", async () => {
    const onSubmit = vi.fn();
    const onCreateSkill = vi.fn(async (_input: SkillUpsert) => personalStyleSkill);
    const fetchMock = vi.fn().mockResolvedValue(
      styleStreamResponse([
        {
          type: "done",
          skillDraft: {
            title: "克制产品随笔",
            description: "短句、具体、少夸张。",
            prompt: "保持短句，写具体例子。"
          }
        }
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    renderRootMemorySetup({
      onCreateSkill,
      onSubmit,
      onUpdateSkill: vi.fn(),
      styleProfileExternalAvailable: false
    });

    await userEvent.click(screen.getByRole("button", { name: "立即设置" }));
    await userEvent.click(screen.getByRole("button", { name: "粘贴代表作生成" }));
    await userEvent.type(screen.getByRole("textbox", { name: "代表作 1" }), "第一段代表作。\n\n内部空行。");
    await userEvent.click(screen.getByRole("button", { name: "添加一段代表作" }));
    await userEvent.type(screen.getByRole("textbox", { name: "代表作 2" }), "第二段代表作。");
    await userEvent.click(screen.getByRole("button", { name: "生成我的风格" }));
    expect(await screen.findByRole("textbox", { name: "风格名称" })).toHaveValue("克制产品随笔");

    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "我想写 AI 产品经理的真实困境");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/skills/style/generate-from-samples",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ samples: ["第一段代表作。\n\n内部空行。", "第二段代表作。"] })
      })
    );
    expect(onCreateSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "我的风格：克制产品随笔",
        category: "风格",
        appliesTo: "both",
        defaultEnabled: true
      })
    );
    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ seed: "我想写 AI 产品经理的真实困境" }),
      enabledSkillIds: ["system-analysis", "style-new"]
    });
  });

  it("selects a default personal style skill for future new thoughts", async () => {
    const onSubmit = vi.fn();
    renderRootMemorySetup({
      onCreateSkill: vi.fn(),
      onSubmit,
      onUpdateSkill: vi.fn(),
      skills: [...skills, personalStyleSkill]
    });

    expect(screen.getByRole("button", { name: "展开我的风格设置：克制产品随笔" })).toBeInTheDocument();
    expect(screen.getByText("已启用 2 个技能")).toBeInTheDocument();
    expect(screen.getByText("我的风格：克制产品随笔")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开技能列表" }));

    expect(screen.getByRole("checkbox", { name: /我的风格：克制产品随笔/ })).toBeChecked();

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "我想写下一个念头");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({ seed: "我想写下一个念头" }),
      enabledSkillIds: ["system-analysis", "style-new"]
    });
  });

  it("lets the user combine quick request choices with custom input", async () => {
    const onSubmit = vi.fn();
    renderRootMemorySetup({ onSubmit });

    await userEvent.type(screen.getByRole("textbox", { name: "创作 seed" }), "周末想写个观察");
    await userEvent.click(screen.getByRole("button", { name: "展开更多创作要求" }));
    await userEvent.click(screen.getByRole("button", { name: "改成英文" }));
    await userEvent.click(screen.getByRole("button", { name: "展开自定义创作要求" }));
    await userEvent.type(screen.getByRole("textbox", { name: "自定义创作要求" }), "，写给第一次接触这个话题的人");
    await userEvent.click(screen.getByRole("button", { name: "用这个念头开始" }));

    expect(onSubmit).toHaveBeenCalledWith({
      preferences: expect.objectContaining({
        seed: "周末想写个观察",
        creationRequest: "改成英文，写给第一次接触这个话题的人"
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
    expect(screen.queryByRole("group", { name: "判断工作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "技能库" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开技能列表" }));

    expect(screen.getByRole("group", { name: "判断工作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "技能库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起技能列表" })).toBeInTheDocument();
  });

  it("uses a subtle skill list disclosure control", () => {
    renderRootMemorySetup();

    const toggleButton = screen.getByRole("button", { name: "展开技能列表" });

    expect(toggleButton).toHaveClass("root-setup__skills-toggle");
    expect(toggleButton).not.toHaveClass("icon-button");
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

    expect(screen.getByRole("group", { name: "判断工作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "技能库" })).toBeInTheDocument();
  });

  it("summarizes default content team skills as the creator group", async () => {
    const contentTeamSkills: Skill[] = [
      contentTeamSkill("system-creator", "创作者"),
      contentTeamSkill("system-writer", "写手"),
      contentTeamSkill("system-publisher", "发布编辑"),
      contentTeamSkill("system-reviewer", "审稿"),
      contentTeamSkill("system-planner", "策划"),
      contentTeamSkill("system-researcher", "资料员")
    ];
    renderRootMemorySetup({ skills: contentTeamSkills });

    expect(screen.getByText("已启用 1 个技能组，6 个技能")).toBeInTheDocument();
    const summary = screen.getByLabelText("已启用技能摘要");
    expect(within(summary).getByText("创作者（含 6 个）")).toBeInTheDocument();
    expect(within(summary).queryByText("策划")).not.toBeInTheDocument();
    expect(within(summary).queryByText("资料员")).not.toBeInTheDocument();
    expect(within(summary).queryByText("写手")).not.toBeInTheDocument();
    expect(within(summary).queryByRole("button", { name: /还有/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开技能列表" }));

    const contentTeamGroup = screen.getByRole("group", { name: "内容团队" });
    const creatorGroup = within(contentTeamGroup).getByRole("group", { name: "创作者" });
    const labels = within(creatorGroup).getAllByRole("checkbox").map((checkbox) => checkbox.closest("label")?.textContent);

    expect(labels).toEqual([
      expect.stringContaining("创作者"),
      expect.stringContaining("整体流程"),
      expect.stringContaining("策划"),
      expect.stringContaining("资料员"),
      expect.stringContaining("写手"),
      expect.stringContaining("审稿"),
      expect.stringContaining("发布编辑")
    ]);
    expect(within(creatorGroup).getAllByRole("checkbox").every((checkbox) => checkbox instanceof HTMLInputElement && checkbox.checked)).toBe(
      true
    );
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

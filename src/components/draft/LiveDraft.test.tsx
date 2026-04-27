import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LiveDraft } from "./LiveDraft";

describe("LiveDraft", () => {
  it("renders the final publishing package when available", () => {
    render(
      <LiveDraft
        draft={{ title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" }}
        isBusy={false}
        publishPackage={{ title: "Final", body: "Final body", hashtags: ["#AI"], imagePrompt: "glowing tree" }}
      />
    );

    expect(screen.getByText("Final")).toBeInTheDocument();
    expect(screen.getByText("#AI")).toBeInTheDocument();
    expect(screen.getByText("glowing tree")).toBeInTheDocument();
  });

  it("renders draft body line breaks as separate paragraphs", () => {
    render(
      <LiveDraft
        draft={{ title: "Draft", body: "第一段\n第二段", hashtags: [], imagePrompt: "" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    expect(screen.getByText("第一段").tagName.toLowerCase()).toBe("p");
    expect(screen.getByText("第二段").tagName.toLowerCase()).toBe("p");
  });

  it("shows a no-op generate image button with the image prompt", async () => {
    render(
      <LiveDraft
        draft={{ title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "生成图片" }));

    expect(screen.getByText("draft image")).toBeInTheDocument();
  });

  it("toggles inline diff markup inside the current draft view", async () => {
    render(
      <LiveDraft
        draft={{ title: "标题", body: "保留一句。新增一句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        previousDraft={{ title: "标题", body: "保留一句。删掉一句。", hashtags: ["#上级"], imagePrompt: "上级画面" }}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "对比" }));

    expect(screen.queryByText("上级草稿 → 当前草稿")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "标题" })).toBeInTheDocument();
    expect(screen.getAllByText("新增").some((element) => element.classList.contains("draft-diff-token--added"))).toBe(true);
    expect(screen.getByText("删掉")).toHaveClass("draft-diff-token--removed");

    await userEvent.click(screen.getByRole("button", { name: "关闭对比" }));

    expect(screen.queryByText("上级草稿 → 当前草稿")).not.toBeInTheDocument();
    expect(screen.queryByText("删掉")).not.toBeInTheDocument();
    expect(screen.getByText("保留一句。新增一句。")).toBeInTheDocument();
  });

  it("automatically renders parent-to-streaming draft diff in live diff mode", () => {
    const onSave = vi.fn();

    render(
      <LiveDraft
        draft={{ title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
        isBusy
        isEditable
        isLiveDiff
        isLiveDiffStreaming
        onSave={onSave}
        previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    expect(screen.getByText("AI 正在生成下一版草稿...")).toBeInTheDocument();
    expect(screen.getByText("新增句")).toHaveClass("draft-diff-token--added");
    expect(screen.getByText("#旧")).toHaveClass("draft-diff-token--removed");
    expect(screen.queryByRole("button", { name: "对比" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /选择差异/ })).toHaveLength(0);
  });

  it("marks the current writing point with a cursor while live text is streaming", () => {
    render(
      <LiveDraft
        draft={{ title: "旧标题", body: "旧正文新增句", hashtags: ["#旧"], imagePrompt: "旧图" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    const cursor = screen.getByLabelText("正在生成到这里");
    const currentLine = cursor.closest(".draft-stream-current-line");
    expect(cursor).toHaveClass("draft-stream-cursor");
    expect(cursor.closest(".draft-body")).not.toBeNull();
    expect(currentLine).not.toBeNull();
    expect(currentLine).toHaveTextContent("新增句");
  });

  it("keeps ungenerated parent body text unchanged during streaming", () => {
    render(
      <LiveDraft
        draft={{ title: "旧标题", body: "已经生成的开头。", hashtags: ["#旧"], imagePrompt: "旧图" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={{
          title: "旧标题",
          body: "已经生成的开头。还没有生成到的旧内容。",
          hashtags: ["#旧"],
          imagePrompt: "旧图"
        }}
        publishPackage={null}
      />
    );

    expect(screen.getByText("已经生成的开头。")).toHaveClass("draft-diff-token--same");
    expect(screen.getByText("还没有生成到的旧内容。")).toHaveClass("draft-diff-token--same");
    expect(screen.getByLabelText("正在生成到这里").closest(".draft-stream-current-line")?.nextElementSibling).toHaveTextContent(
      "还没有生成到的旧内容。"
    );
    expect(screen.getByText("还没有生成到的旧内容。")).not.toHaveClass("draft-diff-token--removed");
  });

  it("places the streaming cursor before parent text before any new body text arrives", () => {
    render(
      <LiveDraft
        draft={{ title: "旧标题", body: "还没有开始生成的父稿。", hashtags: ["#旧"], imagePrompt: "旧图" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={{ title: "旧标题", body: "还没有开始生成的父稿。", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    const cursorLine = screen.getByLabelText("正在生成到这里").closest(".draft-stream-current-line");
    expect(cursorLine).not.toBeNull();
    expect(cursorLine?.nextElementSibling).toHaveTextContent("还没有开始生成的父稿。");
    expect(screen.getByText("还没有开始生成的父稿。")).toHaveClass("draft-diff-token--same");
  });

  it("shows only generated body changes before the unchanged parent tail while streaming", () => {
    render(
      <LiveDraft
        draft={{ title: "旧标题", body: "已经生成的开头。新写出来的一句", hashtags: ["#旧"], imagePrompt: "旧图" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={{
          title: "旧标题",
          body: "已经生成的开头。还没有生成到的旧内容。",
          hashtags: ["#旧"],
          imagePrompt: "旧图"
        }}
        publishPackage={null}
      />
    );

    expect(screen.getByText("新写出来的一句")).toHaveClass("draft-diff-token--added");
    expect(screen.getByText("新写出来的一句").closest(".draft-stream-current-line")).not.toBeNull();
    expect(screen.getByText("旧内容。")).toHaveClass("draft-diff-token--same");
    expect(screen.getByLabelText("正在生成到这里").closest(".draft-stream-current-line")?.nextElementSibling).toHaveTextContent(
      "旧内容。"
    );
    expect(screen.getByText("旧内容。")).not.toHaveClass("draft-diff-token--removed");
    expect(screen.queryByText("还没有生成到的")).not.toBeInTheDocument();
  });

  it("progressively consumes the old body placeholder when the new stream starts from different text", () => {
    render(
      <LiveDraft
        draft={{ title: "新标题", body: "新的第一句。新的第二句。", hashtags: ["#旧"], imagePrompt: "旧图" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={{ title: "旧标题", body: "旧的第一句。旧的第二句。旧的第三句。", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    expect(screen.getByText("新的第一句。新的第二句。")).toHaveClass("draft-diff-token--added");
    expect(screen.getByText("新的第一句。新的第二句。").closest(".draft-stream-current-line")).not.toBeNull();
    expect(screen.queryByText("旧的第一句。旧的第二句。旧的第三句。")).not.toBeInTheDocument();
    expect(screen.getByText("旧的第三句。")).toHaveClass("draft-diff-token--same");
  });

  it("moves the active streaming highlight to the image prompt once image text is arriving", () => {
    render(
      <LiveDraft
        draft={{ title: "旧标题", body: "旧正文新增句", hashtags: ["#旧"], imagePrompt: "正在生成的配图提示" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "" }}
        publishPackage={null}
      />
    );

    expect(screen.getByText("新增句")).toHaveClass("draft-diff-token--added");
    expect(screen.getByText("新增句").closest(".draft-stream-current-line")).toBeNull();
    expect(screen.getByText("正在生成的配图提示").closest(".draft-stream-current-line")).not.toBeNull();
    expect(screen.getByLabelText("正在生成到这里").closest(".image-prompt")).not.toBeNull();
  });

  it("keeps completed body diff stable when the image prompt stream has started", () => {
    render(
      <LiveDraft
        draft={{ title: "旧标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        liveDiffStreamingField="imagePrompt"
        previousDraft={{ title: "旧标题", body: "旧正文旧尾巴", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    expect(screen.getByText("新增句")).toHaveClass("draft-diff-token--added");
    expect(screen.getByText("新增句").closest(".draft-stream-current-line")).toBeNull();
    expect(screen.getByText("旧尾巴")).toHaveClass("draft-diff-token--removed");
    expect(screen.getByLabelText("正在生成到这里").closest(".image-prompt")).not.toBeNull();
    expect(screen.getByText("旧图")).toHaveClass("draft-diff-token--same");
  });

  it("scrolls the active streaming line into view as text arrives", () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      render(
        <LiveDraft
          draft={{ title: "旧标题", body: "已经生成的开头。新写出来的一句", hashtags: ["#旧"], imagePrompt: "旧图" }}
          isBusy
          isLiveDiff
          isLiveDiffStreaming
          previousDraft={{
            title: "旧标题",
            body: "已经生成的开头。还没有生成到的旧内容。",
            hashtags: ["#旧"],
            imagePrompt: "旧图"
          }}
          publishPackage={null}
        />
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("uses a prominent streaming cursor style", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const cursorRule = css.match(/\.draft-stream-cursor\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const lineRule = css.match(/\.draft-stream-current-line\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const fullLineRule = css.match(/\.draft-stream-current-line::before\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const lineAddedRule =
      css.match(/\.draft-stream-current-line \.draft-diff-token--added\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(cursorRule).toContain("width: 6px");
    expect(cursorRule).toContain("box-shadow: 0 0 0 3px");
    expect(lineRule).toContain("position: relative");
    expect(lineRule).toContain("background:");
    expect(lineRule).toContain("box-shadow:");
    expect(lineRule).toContain("outline:");
    expect(lineRule).toContain("box-decoration-break: clone");
    expect(fullLineRule).toContain("left: -100vmax");
    expect(fullLineRule).toContain("right: -100vmax");
    expect(fullLineRule).toContain("background:");
    expect(lineAddedRule).toContain("background:");
    expect(lineAddedRule).not.toContain("transparent");
  });

  it("lets generated diff review be dismissed after streaming completes", async () => {
    const onDismissLiveDiff = vi.fn();

    render(
      <LiveDraft
        draft={{ title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
        isBusy={false}
        isEditable
        isLiveDiff
        onDismissLiveDiff={onDismissLiveDiff}
        previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    expect(screen.getByText("新增句")).toHaveClass("draft-diff-token--added");
    expect(screen.queryByLabelText("正在生成到这里")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "关闭对比" }));

    expect(onDismissLiveDiff).toHaveBeenCalledTimes(1);
  });

  it("hides an open editor when live diff mode starts", async () => {
    const draft = { title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" };
    const previousDraft = { title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" };

    const { rerender } = render(
      <LiveDraft
        draft={draft}
        isBusy={false}
        isEditable
        previousDraft={previousDraft}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("正文")).toBeInTheDocument();

    rerender(
      <LiveDraft
        draft={draft}
        isBusy
        isEditable
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={previousDraft}
        publishPackage={null}
      />
    );

    expect(screen.queryByLabelText("正文")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.getByText("新增句")).toHaveClass("draft-diff-token--added");
  });

  it("renders an arbitrary node-to-node comparison when the app provides one", async () => {
    const { container } = render(
      <LiveDraft
        comparisonDrafts={{
          from: { title: "第二版", body: "保留一句。第二版。", hashtags: ["#二", "#共同"], imagePrompt: "第二张图" },
          to: { title: "第一版", body: "保留一句。第一版。", hashtags: ["#一", "#共同"], imagePrompt: "第一张图" }
        }}
        comparisonLabels={{ from: "第 2 轮 · 调整", to: "第 1 轮 · 起稿" }}
        draft={{ title: "第三版", body: "保留一句。第三版。", hashtags: ["#三"], imagePrompt: "第三张图" }}
        isBusy={false}
        isComparisonMode
        onCancelComparison={vi.fn()}
        publishPackage={null}
      />
    );

    expect(screen.getByText("第 2 轮 · 调整 → 第 1 轮 · 起稿")).toBeInTheDocument();
    expect(screen.getAllByText("第二").some((element) => element.classList.contains("draft-diff-token--removed"))).toBe(true);
    expect(screen.getAllByText("第一").some((element) => element.classList.contains("draft-diff-token--added"))).toBe(true);
    expect(screen.getByText("第二张")).toHaveClass("draft-diff-token--removed");
    expect(screen.getByText("第一张")).toHaveClass("draft-diff-token--added");

    const tagRow = container.querySelector(".tag-row");
    expect(tagRow).not.toBeNull();
    expect(tagRow?.children).toHaveLength(3);
    expect(within(tagRow as HTMLElement).getByText("#二")).toHaveClass("draft-diff-token--removed");
    expect(within(tagRow as HTMLElement).getByText("#一")).toHaveClass("draft-diff-token--added");
    expect(within(tagRow as HTMLElement).getByText("#共同")).toHaveClass("draft-diff-token--same");
  });

  it("prompts for a start node when the current draft is already the comparison endpoint", () => {
    render(
      <LiveDraft
        comparisonSelectionCount={1}
        draft={{ title: "当前版", body: "当前正文", hashtags: [], imagePrompt: "" }}
        isBusy={false}
        isComparisonMode
        onCancelComparison={vi.fn()}
        publishPackage={null}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("已选终点，选择起点");
  });

  it("does not show the parent diff toggle for final packages", () => {
    render(
      <LiveDraft
        draft={{ title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" }}
        isBusy={false}
        previousDraft={{ title: "Parent", body: "Parent body", hashtags: ["#parent"], imagePrompt: "parent image" }}
        publishPackage={{ title: "Final", body: "Final body", hashtags: ["#AI"], imagePrompt: "glowing tree" }}
      />
    );

    expect(screen.queryByRole("button", { name: "对比" })).not.toBeInTheDocument();
  });

  it("replaces old seed placeholder titles with a title from the draft body", () => {
    render(
      <LiveDraft
        draft={{ title: "种子念头", body: "小林是某厂的产品经理，每周要跟进十几个需求迭代。", hashtags: [], imagePrompt: "" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    expect(screen.getByText("小林是某厂的产品经理")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "种子念头" })).not.toBeInTheDocument();
  });

  it("keeps draft content inside a dedicated scroll area", () => {
    const { container } = render(
      <LiveDraft
        draft={{ title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    expect(container.querySelector(".draft-panel__scroll")).toContainElement(screen.getByText("Draft"));
    expect(container.querySelector(".draft-panel__scroll")).toContainElement(screen.getByText("Draft body"));
  });

  it("lets the draft scrollbar reach the panel right edge", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const panelRule = [...css.matchAll(/(?:^|\n)\.draft-panel\s*\{(?<body>[^}]+)\}/g)].at(-1)?.groups?.body ?? "";
    const headingRule = css.match(/\.panel-heading\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const scrollRule = css.match(/\.draft-panel__scroll\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(panelRule).toContain("padding: 18px 0 18px 18px");
    expect(headingRule).toContain("padding-right: 18px");
    expect(scrollRule).toContain("padding-right: 18px");
  });

  it("keeps header popovers outside the draft scroll area", () => {
    const { container } = render(
      <LiveDraft
        draft={{ title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" }}
        headerPanel={<aside>技能弹层</aside>}
        isBusy={false}
        publishPackage={null}
      />
    );

    const popover = container.querySelector(".draft-panel__popover");
    const scrollArea = container.querySelector(".draft-panel__scroll");

    expect(popover).toContainElement(screen.getByText("技能弹层"));
    expect(scrollArea).not.toContainElement(screen.getByText("技能弹层"));
  });

  it("lets the current draft be edited and saved", async () => {
    const onSave = vi.fn();

    render(
      <LiveDraft
        draft={{ title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" }}
        isBusy={false}
        isEditable
        onSave={onSave}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    await userEvent.clear(screen.getByLabelText("正文"));
    await userEvent.type(screen.getByLabelText("正文"), "Edited body");
    await userEvent.click(screen.getByRole("button", { name: "保存为自定义编辑" }));

    expect(onSave).toHaveBeenCalledWith({
      title: "Draft",
      body: "Edited body",
      hashtags: ["#draft"],
      imagePrompt: "draft image"
    });
  });

  it("lets a comparison diff token be reverted and saved without entering a separate editor", async () => {
    const onSave = vi.fn();

    render(
      <LiveDraft
        comparisonDrafts={{
          from: { title: "旧标题", body: "保留", hashtags: ["#旧"], imagePrompt: "旧图" },
          to: { title: "新标题", body: "保留新增", hashtags: ["#新"], imagePrompt: "新图" }
        }}
        comparisonLabels={{ from: "第 1 轮 · 旧", to: "第 2 轮 · 新" }}
        draft={{ title: "新标题", body: "保留新增", hashtags: ["#新"], imagePrompt: "新图" }}
        isBusy={false}
        isComparisonMode
        isEditable
        onCancelComparison={vi.fn()}
        onSave={onSave}
        publishPackage={null}
      />
    );

    expect(screen.queryByRole("button", { name: "编辑对比" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤销新增：新增" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "选择差异：新增" }));
    const actionPopover = screen.getByRole("button", { name: "撤销新增：新增" }).closest(".draft-diff-token-popover");
    expect(actionPopover).toBeInTheDocument();
    expect(actionPopover?.parentElement).toBe(document.body);
    await userEvent.click(screen.getByRole("button", { name: "关闭差异操作" }));
    expect(screen.queryByRole("button", { name: "撤销新增：新增" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "选择差异：新增" }));
    expect(screen.getByRole("button", { name: "撤销新增：新增" })).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole("button", { name: "撤销新增：新增" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "选择差异：新增" }));
    await userEvent.click(screen.getByRole("button", { name: "撤销新增：新增" }));
    await userEvent.click(screen.getByRole("button", { name: "保存为自定义编辑" }));

    expect(onSave).toHaveBeenCalledWith({
      title: "新标题",
      body: "保留",
      hashtags: ["#新"],
      imagePrompt: "新图"
    });
  });

  it("keeps the diff action popover anchored while the draft scrolls", async () => {
    render(
      <LiveDraft
        comparisonDrafts={{
          from: { title: "旧标题", body: "保留", hashtags: ["#旧"], imagePrompt: "旧图" },
          to: { title: "新标题", body: "保留新增", hashtags: ["#新"], imagePrompt: "新图" }
        }}
        comparisonLabels={{ from: "第 1 轮 · 旧", to: "第 2 轮 · 新" }}
        draft={{ title: "新标题", body: "保留新增", hashtags: ["#新"], imagePrompt: "新图" }}
        isBusy={false}
        isComparisonMode
        isEditable
        onCancelComparison={vi.fn()}
        onSave={vi.fn()}
        publishPackage={null}
      />
    );

    const diffToken = screen.getByRole("button", { name: "选择差异：新增" });
    const rect = vi
      .spyOn(diffToken, "getBoundingClientRect")
      .mockReturnValueOnce({ bottom: 100, left: 24, right: 64, top: 80 } as DOMRect)
      .mockReturnValueOnce({ bottom: 56, left: 24, right: 64, top: 36 } as DOMRect);

    await userEvent.click(diffToken);

    const actionPopover = screen.getByRole("button", { name: "撤销新增：新增" }).closest(".draft-diff-token-popover");
    expect(actionPopover).toHaveStyle({ left: "24px", top: "106px" });

    fireEvent.scroll(document.querySelector(".draft-panel__scroll") as Element);

    expect(actionPopover).toHaveStyle({ left: "24px", top: "62px" });
    rect.mockRestore();
  });
});

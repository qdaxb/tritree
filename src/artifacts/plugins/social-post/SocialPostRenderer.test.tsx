import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/lib/domain";
import { SocialPostRenderer } from "./SocialPostRenderer";

function createArtifact(payload: unknown, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    type: "social-post",
    version: 1,
    payload,
    sourceArtifactIds: [],
    createdByNodeId: "node-1",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z",
    ...overrides
  };
}

function selectTextInside(element: HTMLElement, text: string) {
  const textNode = findTextNodeContaining(element, text);
  expect(textNode).toBeDefined();
  const start = textNode!.textContent!.indexOf(text);
  expect(start).toBeGreaterThanOrEqual(0);

  const range = document.createRange();
  range.setStart(textNode!, start);
  range.setEnd(textNode!, start + text.length);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function selectTextRange(startElement: HTMLElement, startOffset: number, endElement: HTMLElement, endOffset: number) {
  const startNode = startElement.firstChild;
  const endNode = endElement.firstChild;
  expect(startNode?.nodeType).toBe(Node.TEXT_NODE);
  expect(endNode?.nodeType).toBe(Node.TEXT_NODE);

  const range = document.createRange();
  range.setStart(startNode!, startOffset);
  range.setEnd(endNode!, endOffset);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function findTextNodeContaining(node: Node, text: string): Text | null {
  if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes(text)) return node as Text;

  for (const child of Array.from(node.childNodes)) {
    const match = findTextNodeContaining(child, text);
    if (match) return match;
  }

  return null;
}

describe("SocialPostRenderer", () => {
  it("lets the social content fill the available artifact height", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const scrollRule = css.match(/\.social-post-panel__scroll\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const contentRule = css.match(/\.work-content\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const imagePromptRule = css.match(/\.image-prompt\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(scrollRule).toContain("display: grid");
    expect(scrollRule).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(contentRule).toContain("min-height: 100%");
    expect(contentRule).toContain("display: flex");
    expect(contentRule).toContain("flex-direction: column");
    expect(imagePromptRule).toContain("flex: 1 1 auto");
  });

  it("renders social post body line breaks as separate paragraphs", () => {
    render(
      <SocialPostRenderer
        artifact={createArtifact({ title: "标题", body: "第一段\n第二段", hashtags: ["#AI"], imagePrompt: "图" })}
        isBusy={false}
      />
    );

    expect(screen.getByText("第一段").tagName.toLowerCase()).toBe("p");
    expect(screen.getByText("第二段").tagName.toLowerCase()).toBe("p");
    expect(screen.getByText("#AI")).toBeInTheDocument();
    expect(screen.getByText("图")).toBeInTheDocument();
  });

  it("shows inline diff tokens while a streamed draft is replacing a previous artifact", () => {
    const previousArtifact = createArtifact(
      { title: "旧标题", body: "第一段旧正文。", hashtags: ["#旧"], imagePrompt: "旧图" },
      { id: "artifact-old" }
    );
    const streamingArtifact = createArtifact(
      { title: "新标题", body: "第一段旧正文。新增一句。", hashtags: ["#旧", "#新"], imagePrompt: "新图" },
      { id: "artifact-streaming", sourceArtifactIds: ["artifact-old"] }
    );

    render(<SocialPostRenderer artifact={streamingArtifact} isBusy={true} previousArtifact={previousArtifact} />);

    expect(screen.getByTestId("social-post-inline-diff")).toBeInTheDocument();
    expect(document.querySelectorAll(".work-diff-token--added").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".work-diff-token--removed").length).toBeGreaterThan(0);
  });

  it("keeps inline diff visible after a generated draft finishes", () => {
    const previousArtifact = createArtifact(
      { title: "旧标题", body: "第一段旧正文。", hashtags: ["#旧"], imagePrompt: "旧图" },
      { id: "artifact-old" }
    );
    const generatedArtifact = createArtifact(
      { title: "新标题", body: "第一段旧正文。新增一句。", hashtags: ["#旧", "#新"], imagePrompt: "新图" },
      { id: "artifact-generated", sourceArtifactIds: ["artifact-old"] }
    );

    render(<SocialPostRenderer artifact={generatedArtifact} isBusy={false} previousArtifact={previousArtifact} />);

    expect(screen.getByTestId("social-post-inline-diff")).toBeInTheDocument();
    expect(document.querySelectorAll(".work-diff-token--added").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".work-diff-token--removed").length).toBeGreaterThan(0);
  });

  it("saves edited social post payloads", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SocialPostRenderer
        artifact={createArtifact({ title: "标题", body: "正文", hashtags: ["#旧"], imagePrompt: "旧图" })}
        isBusy={false}
        onSave={onSave}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    await userEvent.clear(screen.getByLabelText("标题"));
    await userEvent.type(screen.getByLabelText("标题"), "新标题");
    await userEvent.clear(screen.getByLabelText("正文"));
    await userEvent.type(screen.getByLabelText("正文"), "新正文");
    await userEvent.clear(screen.getByLabelText("话题"));
    await userEvent.type(screen.getByLabelText("话题"), "#新 #AI");
    await userEvent.clear(screen.getByLabelText("配图提示"));
    await userEvent.type(screen.getByLabelText("配图提示"), "新图");
    await userEvent.click(screen.getByRole("button", { name: "保存作品" }));

    expect(onSave).toHaveBeenCalledWith({
      title: "新标题",
      body: "新正文",
      hashtags: ["#新", "#AI"],
      imagePrompt: "新图"
    });
  });

  it("renders publish as a prominent card action outside the heading action cluster", () => {
    render(
      <SocialPostRenderer
        artifact={createArtifact({ title: "标题", body: "正文", hashtags: ["#AI"], imagePrompt: "图" })}
        isBusy={false}
        onSave={vi.fn()}
      />
    );

    const headingActions = document.querySelector(".social-post-panel__actions");
    expect(headingActions).toBeInstanceOf(HTMLElement);
    expect(within(headingActions as HTMLElement).queryByRole("button", { name: "发布" })).not.toBeInTheDocument();
    expect(within(headingActions as HTMLElement).getByRole("button", { name: "编辑" })).toBeInTheDocument();

    const primaryAction = document.querySelector(".social-post-panel__primary-action");
    expect(primaryAction).toBeInstanceOf(HTMLElement);
    expect(within(primaryAction as HTMLElement).getByRole("button", { name: "发布" })).toBeInTheDocument();
  });

  it("opens the publish assistant from the prominent card action", async () => {
    render(
      <SocialPostRenderer
        artifact={createArtifact({ title: "标题", body: "正文", hashtags: ["#AI"], imagePrompt: "图" })}
        isBusy={false}
      />
    );

    const primaryAction = document.querySelector(".social-post-panel__primary-action");
    expect(primaryAction).toBeInstanceOf(HTMLElement);

    const publishButton = within(primaryAction as HTMLElement).getByRole("button", { name: "发布" });
    expect(publishButton).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(publishButton);

    expect(publishButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "发布助手" })).toBeInTheDocument();
  });

  it("disables the prominent publish action while busy", () => {
    render(
      <SocialPostRenderer
        artifact={createArtifact({ title: "标题", body: "正文", hashtags: ["#AI"], imagePrompt: "图" })}
        isBusy={true}
      />
    );

    const primaryAction = document.querySelector(".social-post-panel__primary-action");
    expect(primaryAction).toBeInstanceOf(HTMLElement);
    expect(within(primaryAction as HTMLElement).getByRole("button", { name: "发布" })).toBeDisabled();
  });

  it("closes the publish assistant before entering edit mode", async () => {
    render(
      <SocialPostRenderer
        artifact={createArtifact({ title: "标题", body: "正文", hashtags: ["#AI"], imagePrompt: "图" })}
        isBusy={false}
        onSave={vi.fn()}
      />
    );

    const primaryAction = document.querySelector(".social-post-panel__primary-action");
    expect(primaryAction).toBeInstanceOf(HTMLElement);

    await userEvent.click(within(primaryAction as HTMLElement).getByRole("button", { name: "发布" }));
    expect(screen.getByRole("dialog", { name: "发布助手" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));

    expect(screen.queryByRole("dialog", { name: "发布助手" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "标题" })).toBeInTheDocument();
  });

  it("submits a rewrite-selection action for selected body text", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(
      <SocialPostRenderer
        artifact={createArtifact({ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#AI"], imagePrompt: "图" })}
        isBusy={false}
        onAction={onAction}
      />
    );

    const paragraph = screen.getByText("重复句。目标句。重复句。");
    selectTextInside(paragraph, "目标句。");
    fireEvent.mouseUp(paragraph);
    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "补一个细节");
    await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

    expect(onAction).toHaveBeenCalledWith("rewrite-selection", {
      field: "body",
      instruction: "补一个细节",
      selectedText: "目标句。",
      selectionEnd: 8,
      selectionStart: 4
    });
  });

  it("uses the source body slice when selected text spans rendered paragraphs", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(
      <SocialPostRenderer
        artifact={createArtifact({ title: "标题", body: "第一段\n\n第二段", hashtags: ["#AI"], imagePrompt: "图" })}
        isBusy={false}
        onAction={onAction}
      />
    );

    const firstParagraph = screen.getByText("第一段");
    const secondParagraph = screen.getByText("第二段");
    selectTextRange(firstParagraph, 1, secondParagraph, 2);
    fireEvent.mouseUp(firstParagraph.parentElement!);
    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "补一个细节");
    await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

    expect(onAction).toHaveBeenCalledWith("rewrite-selection", {
      field: "body",
      instruction: "补一个细节",
      selectedText: "一段\n\n第二",
      selectionEnd: 7,
      selectionStart: 1
    });
  });

  it("copies selected body text from the selection action bubble", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <SocialPostRenderer
        artifact={createArtifact({ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#AI"], imagePrompt: "图" })}
        isBusy={false}
        onAction={vi.fn()}
      />
    );

    const paragraph = screen.getByText("重复句。目标句。重复句。");
    selectTextInside(paragraph, "目标句。");
    fireEvent.mouseUp(paragraph);
    await userEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(writeText).toHaveBeenCalledWith("目标句。");
    expect(screen.queryByRole("toolbar", { name: "选中文本操作" })).not.toBeInTheDocument();
  });

  it("copies the edited publish text from the publish assistant", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <SocialPostRenderer
        artifact={createArtifact({ title: "标题", body: "原始正文", hashtags: ["#AI"], imagePrompt: "图" })}
        isBusy={false}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    const publishText = screen.getByRole("textbox", { name: "微博发布文案" });
    await userEvent.clear(publishText);
    await userEvent.type(publishText, "编辑后的微博文案");
    await userEvent.click(screen.getByRole("button", { name: "复制微博文案" }));

    expect(writeText).toHaveBeenCalledWith("编辑后的微博文案");
  });
});

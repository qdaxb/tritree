import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LiveDraft } from "./LiveDraft";

function setCodeMirrorText(textbox: HTMLElement, value: string) {
  const view = EditorView.findFromDOM(textbox);
  expect(view).not.toBeNull();

  act(() => {
    view?.dispatch({
      changes: {
        from: 0,
        insert: value,
        to: view.state.doc.length
      }
    });
  });
}

function getCodeMirrorText(textbox: HTMLElement) {
  const view = EditorView.findFromDOM(textbox);
  expect(view).not.toBeNull();
  return view?.state.doc.toString() ?? "";
}

function selectTextInside(element: HTMLElement, text: string, occurrence = 0) {
  const textNode = findTextNodeContaining(element, text);
  expect(textNode).toBeDefined();
  let start = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    start = textNode!.textContent!.indexOf(text, start + 1);
  }
  expect(start).toBeGreaterThanOrEqual(0);
  const range = document.createRange();
  range.setStart(textNode!, start);
  range.setEnd(textNode!, start + text.length);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function selectTextAcross(startElement: HTMLElement, startText: string, endElement: HTMLElement, endText: string) {
  const startNode = findTextNodeContaining(startElement, startText);
  const endNode = findTextNodeContaining(endElement, endText);
  expect(startNode).toBeDefined();
  expect(endNode).toBeDefined();
  const start = startNode!.textContent!.indexOf(startText);
  const end = endNode!.textContent!.indexOf(endText) + endText.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThanOrEqual(endText.length);
  const range = document.createRange();
  range.setStart(startNode!, start);
  range.setEnd(endNode!, end);
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

function selectCodeMirrorRange(textbox: HTMLElement, from: number, to: number) {
  const view = EditorView.findFromDOM(textbox);
  expect(view).not.toBeNull();

  act(() => {
    view?.dispatch({ selection: { anchor: from, head: to } });
  });
}

function deferredPromise() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("LiveDraft", () => {
  it("renders the draft even if legacy publish package data is present", () => {
    render(
      <LiveDraft
        draft={{ title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" }}
        isBusy={false}
        publishPackage={{ title: "Final", body: "Final body", hashtags: ["#AI"], imagePrompt: "glowing tree" }}
      />
    );

    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Draft body")).toBeInTheDocument();
    expect(screen.getByText("#draft")).toBeInTheDocument();
    expect(screen.queryByText("Final")).not.toBeInTheDocument();
    expect(screen.queryByText("发布包")).not.toBeInTheDocument();
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

  it("opens an AI edit popover for selected body text in display mode and submits the captured range", async () => {
    const onRewriteSelection = vi.fn().mockResolvedValue(undefined);
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={onRewriteSelection}
        publishPackage={null}
      />
    );

    selectTextInside(screen.getByText("重复句。目标句。重复句。"), "目标句。");
    fireEvent.mouseUp(screen.getByText("重复句。目标句。重复句。"));
    expect(screen.getByRole("toolbar", { name: "选中文本操作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "引用" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "修改要求" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "补一个细节");
    await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

    expect(onRewriteSelection).toHaveBeenCalledWith({
      draft: { title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" },
      field: "body",
      instruction: "补一个细节",
      selectedText: "目标句。",
      selectionStart: 4,
      selectionEnd: 8
    });
  });

  it("opens an AI edit popover for selected body text spanning display paragraphs", async () => {
    const onRewriteSelection = vi.fn().mockResolvedValue(undefined);
    const body = "第一段开始。目标一。\n第二段目标二。结尾。";
    render(
      <LiveDraft
        draft={{ title: "标题", body, hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={onRewriteSelection}
        publishPackage={null}
      />
    );

    selectTextAcross(
      screen.getByText("第一段开始。目标一。"),
      "目标一。",
      screen.getByText("第二段目标二。结尾。"),
      "第二段目标二。"
    );
    fireEvent.mouseUp(screen.getByText("第一段开始。目标一。"));
    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "补一个细节");
    await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

    expect(onRewriteSelection).toHaveBeenCalledWith({
      draft: { title: "标题", body, hashtags: ["#当前"], imagePrompt: "当前画面" },
      field: "body",
      instruction: "补一个细节",
      selectedText: "目标一。\n第二段目标二。",
      selectionStart: 6,
      selectionEnd: 18
    });
  });

  it("clears an open selection popover when the selection rewrite callback is removed", async () => {
    const onRewriteSelection = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={onRewriteSelection}
        publishPackage={null}
      />
    );

    selectTextInside(screen.getByText("重复句。目标句。重复句。"), "目标句。");
    fireEvent.mouseUp(screen.getByText("重复句。目标句。重复句。"));
    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "补一个细节");

    rerender(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isEditable
        isBusy={false}
        publishPackage={null}
      />
    );

    expect(screen.queryByRole("textbox", { name: "修改要求" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送修改" })).not.toBeInTheDocument();
    expect(onRewriteSelection).not.toHaveBeenCalled();
  });

  it("opens selected text actions for ordinary read-only draft text", async () => {
    const onRewriteSelection = vi.fn().mockResolvedValue(undefined);
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        onRewriteSelection={onRewriteSelection}
        publishPackage={null}
      />
    );

    selectTextInside(screen.getByText("重复句。目标句。重复句。"), "目标句。");
    fireEvent.mouseUp(screen.getByText("重复句。目标句。重复句。"));
    expect(screen.getByRole("toolbar", { name: "选中文本操作" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "更具体");
    await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

    expect(onRewriteSelection).toHaveBeenCalledWith({
      draft: { title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" },
      field: "body",
      instruction: "更具体",
      selectedText: "目标句。",
      selectionStart: 4,
      selectionEnd: 8
    });
  });

  it("copies selected body text from the selection action bubble without opening the edit popover", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={vi.fn()}
        publishPackage={null}
      />
    );

    selectTextInside(screen.getByText("重复句。目标句。重复句。"), "目标句。");
    fireEvent.mouseUp(screen.getByText("重复句。目标句。重复句。"));
    await userEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(writeText).toHaveBeenCalledWith("目标句。");
    expect(screen.queryByRole("toolbar", { name: "选中文本操作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "修改要求" })).not.toBeInTheDocument();
  });

  it("allows the body selection to be changed after the selection action bubble is open", async () => {
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={vi.fn()}
        publishPackage={null}
      />
    );

    const paragraph = screen.getByText("重复句。目标句。重复句。");
    selectTextInside(paragraph, "目标句。");
    fireEvent.mouseUp(paragraph);
    expect(screen.getByRole("toolbar", { name: "选中文本操作" })).toBeInTheDocument();

    expect(fireEvent.mouseDown(paragraph, { cancelable: true })).toBe(true);
    fireEvent.mouseUp(paragraph);
    expect(screen.queryByRole("toolbar", { name: "选中文本操作" })).not.toBeInTheDocument();
  });

  it("opens selected text actions from a native display body mouseup", () => {
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={vi.fn()}
        publishPackage={null}
      />
    );

    const paragraph = screen.getByText("重复句。目标句。重复句。");
    selectTextInside(paragraph, "目标句。");
    fireEvent.mouseUp(paragraph);

    expect(screen.getByRole("toolbar", { name: "选中文本操作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "引用" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
  });

  it("renders selected text actions outside the draft panel so viewport positioning is not clipped", () => {
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={vi.fn()}
        publishPackage={null}
      />
    );

    const paragraph = screen.getByText("重复句。目标句。重复句。");
    selectTextInside(paragraph, "目标句。");
    fireEvent.mouseUp(paragraph);

    expect(screen.getByRole("toolbar", { name: "选中文本操作" }).parentElement).toBe(document.body);
  });

  it("does not block native display body reselection when stale selected text exists", () => {
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={vi.fn()}
        publishPackage={null}
      />
    );

    const paragraph = screen.getByText("重复句。目标句。重复句。");
    selectTextInside(paragraph, "目标句。");
    expect(fireEvent.mouseDown(paragraph, { cancelable: true })).toBe(true);
  });

  it("keeps selected text controls inside the viewport when the selection is near the edge", async () => {
    const rangeRect = {
      bottom: 740,
      height: 20,
      left: 1000,
      right: 1060,
      top: 720,
      width: 60,
      x: 1000,
      y: 720,
      toJSON: () => ({})
    } as DOMRect;
    const rectSpy = vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(rangeRect);

    try {
      render(
        <LiveDraft
          draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
          isBusy={false}
          isEditable
          onRewriteSelection={vi.fn()}
          publishPackage={null}
        />
      );

      selectTextInside(screen.getByText("重复句。目标句。重复句。"), "目标句。");
      fireEvent.mouseUp(screen.getByText("重复句。目标句。重复句。"));

      const toolbar = screen.getByRole("toolbar", { name: "选中文本操作" });
      expect(toolbar).toHaveStyle({ left: "870px", top: "674px" });

      await userEvent.click(screen.getByRole("button", { name: "引用" }));
      expect(screen.getByRole("dialog", { name: "引用选中文本修改" })).toHaveStyle({
        left: "692px",
        top: "452px"
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("closes the selected body rewrite dialog as soon as the request is submitted", async () => {
    const rewrite = deferredPromise();
    const onRewriteSelection = vi.fn(() => rewrite.promise);
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={onRewriteSelection}
        publishPackage={null}
      />
    );

    selectTextInside(screen.getByText("重复句。目标句。重复句。"), "目标句。");
    fireEvent.mouseUp(screen.getByText("重复句。目标句。重复句。"));
    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "补一个细节");

    await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

    expect(onRewriteSelection).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "引用选中文本修改" })).not.toBeInTheDocument();

    await act(async () => rewrite.resolve());
  });

  it("submits the selected occurrence offset for repeated body text in display mode", async () => {
    const onRewriteSelection = vi.fn().mockResolvedValue(undefined);
    render(
      <LiveDraft
        draft={{ title: "标题", body: "目标句。重复句。目标句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={onRewriteSelection}
        publishPackage={null}
      />
    );

    selectTextInside(screen.getByText("目标句。重复句。目标句。"), "目标句。", 1);
    fireEvent.mouseUp(screen.getByText("目标句。重复句。目标句。"));
    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "补一个细节");
    await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

    expect(onRewriteSelection).toHaveBeenCalledWith({
      draft: { title: "标题", body: "目标句。重复句。目标句。", hashtags: ["#当前"], imagePrompt: "当前画面" },
      field: "body",
      instruction: "补一个细节",
      selectedText: "目标句。",
      selectionStart: 8,
      selectionEnd: 12
    });
  });

  it("opens an AI edit popover for selected body text in the normal editor", async () => {
    const onRewriteSelection = vi.fn().mockResolvedValue(undefined);
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={onRewriteSelection}
        onSave={vi.fn()}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    const bodyTextbox = screen.getByLabelText("正文") as HTMLTextAreaElement;
    bodyTextbox.setSelectionRange(4, 8);
    fireEvent.mouseUp(bodyTextbox);
    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "更具体");
    await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

    expect(onRewriteSelection).toHaveBeenCalledWith({
      draft: { title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" },
      field: "body",
      instruction: "更具体",
      selectedText: "目标句。",
      selectionStart: 4,
      selectionEnd: 8
    });
  });

  it("does not block native textarea reselection after text is selected in the normal editor", async () => {
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={vi.fn()}
        onSave={vi.fn()}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    const bodyTextbox = screen.getByLabelText("正文") as HTMLTextAreaElement;
    bodyTextbox.setSelectionRange(4, 8);

    expect(fireEvent.mouseDown(bodyTextbox, { cancelable: true })).toBe(true);
  });

  it("clears selected text actions after exiting the normal editor", async () => {
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={vi.fn()}
        onSave={vi.fn()}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    const bodyTextbox = screen.getByLabelText("正文") as HTMLTextAreaElement;
    bodyTextbox.setSelectionRange(4, 8);
    fireEvent.mouseUp(bodyTextbox);
    expect(screen.getByRole("toolbar", { name: "选中文本操作" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "退出草稿" }));

    expect(screen.queryByRole("toolbar", { name: "选中文本操作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "引用选中文本修改" })).not.toBeInTheDocument();
  });

  it("clears the normal editor selection popover when local draft fields change", async () => {
    const onRewriteSelection = vi.fn().mockResolvedValue(undefined);
    render(
      <LiveDraft
        draft={{ title: "标题", body: "重复句。目标句。重复句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onRewriteSelection={onRewriteSelection}
        onSave={vi.fn()}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    const bodyTextbox = screen.getByLabelText("正文") as HTMLTextAreaElement;
    bodyTextbox.setSelectionRange(4, 8);
    fireEvent.mouseUp(bodyTextbox);
    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    expect(screen.getByRole("textbox", { name: "修改要求" })).toBeInTheDocument();

    const titleTextbox = screen.getByRole("textbox", { name: "标题" });
    await userEvent.clear(titleTextbox);
    await userEvent.type(titleTextbox, "新标题");

    expect(screen.queryByRole("textbox", { name: "修改要求" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送修改" })).not.toBeInTheDocument();
    expect(onRewriteSelection).not.toHaveBeenCalled();
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

  it("lets the current parent diff be edited directly while the diff stays visible", async () => {
    const onSave = vi.fn();

    render(
      <LiveDraft
        draft={{ title: "标题", body: "保留一句。新增一句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onSave={onSave}
        previousDraft={{ title: "标题", body: "保留一句。删掉一句。", hashtags: ["#上级"], imagePrompt: "上级画面" }}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "对比" }));

    const bodyDiffEditor = screen.getByRole("textbox", { name: "正文" }).closest(".draft-cm-diff-field");
    expect(bodyDiffEditor).not.toBeNull();
    const bodyTextbox = within(bodyDiffEditor as HTMLElement).getByRole("textbox", { name: "正文" });
    expect(bodyTextbox).toHaveAttribute("contenteditable", "true");
    expect(bodyTextbox.closest(".cm-editor")).toHaveClass("cm-merge-b");
    expect(within(bodyDiffEditor as HTMLElement).getByText(/新增/)).toBeInTheDocument();
    expect(within(bodyDiffEditor as HTMLElement).getByText(/删掉/)).toBeInTheDocument();
    expect((bodyDiffEditor as HTMLElement).querySelector(".cm-deletedText, .cm-deletedLine")).not.toBeNull();
    expect((bodyDiffEditor as HTMLElement).querySelector(".cm-changedText, .cm-insertedLine, .cm-changedLine")).not.toBeNull();

    setCodeMirrorText(bodyTextbox, "保留一句。我直接改。");

    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(onSave).toHaveBeenCalledWith({
      title: "标题",
      body: "保留一句。我直接改。",
      hashtags: ["#当前"],
      imagePrompt: "当前画面"
    });
    expect(screen.queryByRole("textbox", { name: "正文" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对比" })).toBeInTheDocument();
  });

  it("exits the current parent diff draft without saving local edits", async () => {
    const onSave = vi.fn();

    render(
      <LiveDraft
        draft={{ title: "标题", body: "保留一句。新增一句。", hashtags: ["#当前"], imagePrompt: "当前画面" }}
        isBusy={false}
        isEditable
        onSave={onSave}
        previousDraft={{ title: "标题", body: "保留一句。删掉一句。", hashtags: ["#上级"], imagePrompt: "上级画面" }}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "对比" }));
    setCodeMirrorText(screen.getByRole("textbox", { name: "正文" }), "我只是临时看看。");

    await userEvent.click(screen.getByRole("button", { name: "退出草稿" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "正文" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对比" })).toBeInTheDocument();
    expect(screen.getByText("保留一句。新增一句。")).toBeInTheDocument();
  });

  it("automatically renders parent-to-streaming draft diff in live diff mode", () => {
    const onSave = vi.fn();
    const { container } = render(
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

    const bodyTextbox = screen.getByRole("textbox", { name: "正文" });
    expect(screen.getByText("AI 正在生成下一版草稿...")).toBeInTheDocument();
    expect(bodyTextbox).toHaveAttribute("contenteditable", "false");
    expect(bodyTextbox.closest(".cm-editor")).toHaveClass("cm-merge-b");
    expect(container.querySelector(".draft-body .draft-diff-token")).toBeNull();
    expect(container.querySelector(".cm-changedText, .cm-insertedLine, .cm-changedLine")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "对比" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /选择差异/ })).toHaveLength(0);
  });

  it("keeps ungenerated parent body text in the read-only merge editor during streaming", () => {
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

    const bodyTextbox = screen.getByRole("textbox", { name: "正文" });
    expect(bodyTextbox).toHaveAttribute("contenteditable", "false");
    expect(getCodeMirrorText(bodyTextbox)).toBe("已经生成的开头。还没有生成到的旧内容。");
    expect(screen.queryByLabelText("正在生成到这里")).not.toBeInTheDocument();
  });

  it("shows the parent body in the merge editor before any new body text arrives", () => {
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

    expect(getCodeMirrorText(screen.getByRole("textbox", { name: "正文" }))).toBe("还没有开始生成的父稿。");
    expect(screen.queryByLabelText("正在生成到这里")).not.toBeInTheDocument();
  });

  it("shows generated body changes before the unchanged parent tail in the merge editor", () => {
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

    const bodyTextbox = screen.getByRole("textbox", { name: "正文" });
    expect(getCodeMirrorText(bodyTextbox)).toBe("已经生成的开头。新写出来的一句旧内容。");
    expect(screen.getByText("新写出来的一句")).toHaveClass("cm-changedText");
    expect(getCodeMirrorText(bodyTextbox)).not.toContain("还没有生成到的");
  });

  it("highlights the current body line while text is streaming", () => {
    render(
      <LiveDraft
        draft={{ title: "旧标题", body: "第一行。\n第二行正在生成", hashtags: ["#旧"], imagePrompt: "旧图" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={{ title: "旧标题", body: "第一行。\n第二行旧内容。", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    const bodyDiffEditor = screen.getByRole("textbox", { name: "正文" }).closest(".draft-cm-diff-field");
    expect(bodyDiffEditor).not.toBeNull();
    const currentLine = [...(bodyDiffEditor as HTMLElement).querySelectorAll(".cm-line")].find((line) =>
      line.textContent?.includes("第二行正在生成")
    );
    expect(currentLine).toHaveClass("cm-stream-current-line");
  });

  it("scrolls the streaming body line into view as text arrives", async () => {
    const elementPrototype = Element.prototype as Omit<Element, "scrollIntoView"> & {
      scrollIntoView?: Element["scrollIntoView"];
    };
    const originalScrollIntoView = elementPrototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    elementPrototype.scrollIntoView = scrollIntoView;

    try {
      const previousDraft = {
        title: "旧标题",
        body: "第一行。\n第二行旧内容。\n第三行旧内容。",
        hashtags: ["#旧"],
        imagePrompt: "旧图"
      };
      const { rerender } = render(
        <LiveDraft
          draft={{ title: "旧标题", body: "第一行。\n第二行正在生成", hashtags: ["#旧"], imagePrompt: "旧图" }}
          isBusy
          isLiveDiff
          isLiveDiffStreaming
          previousDraft={previousDraft}
          publishPackage={null}
        />
      );

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
      });

      scrollIntoView.mockClear();
      rerender(
        <LiveDraft
          draft={{ title: "旧标题", body: "第一行。\n第二行。\n第三行正在生成", hashtags: ["#旧"], imagePrompt: "旧图" }}
          isBusy
          isLiveDiff
          isLiveDiffStreaming
          previousDraft={previousDraft}
          publishPackage={null}
        />
      );

      await waitFor(() => {
        const scrolledCurrentLine = scrollIntoView.mock.contexts.find(
          (context) => context instanceof Element && context.textContent?.includes("第三行正在生成")
        );
        expect(scrolledCurrentLine).toBeDefined();
      });
    } finally {
      if (originalScrollIntoView) elementPrototype.scrollIntoView = originalScrollIntoView;
      else delete elementPrototype.scrollIntoView;
    }
  });

  it("does not show the previous final paragraph as deleted when streaming appends a new paragraph", () => {
    const unchangedFinalParagraph =
      "太阳斜下来，浅金色的浪一层一层推过来。光脚踩进去，凉得缩了一下，又踩进去。沙滩上有人放风筝，线很长，风筝很小。";
    const previousBody = `海水是下午四点才开始变金的。\n\n${unchangedFinalParagraph}`;
    const currentBody = `${previousBody}\n\n风把沙子吹进脚趾缝，我没抖掉。`;

    render(
      <LiveDraft
        draft={{ title: "旧标题", body: currentBody, hashtags: ["#旧"], imagePrompt: "旧图" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={{ title: "旧标题", body: previousBody, hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    const bodyDiffEditor = screen.getByRole("textbox", { name: "正文" }).closest(".draft-cm-diff-field");
    expect(bodyDiffEditor).not.toBeNull();
    expect(getCodeMirrorText(screen.getByRole("textbox", { name: "正文" }))).toBe(currentBody);
    expect((bodyDiffEditor as HTMLElement).querySelector(".cm-deletedChunk")?.textContent).not.toContain(
      unchangedFinalParagraph
    );
    expect(within(bodyDiffEditor as HTMLElement).getByText("风把沙子吹进脚趾缝，我没抖掉。")).toHaveClass("cm-changedText");
  });

  it("does not mix deleted and inserted body text inside the same editor line", () => {
    render(
      <LiveDraft
        draft={{ title: "旧标题", body: "第一句。新句。第三句。", hashtags: ["#旧"], imagePrompt: "旧图" }}
        isBusy={false}
        isEditable
        isLiveDiff
        onSave={vi.fn()}
        previousDraft={{ title: "旧标题", body: "第一句。旧句。第三句。", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    const bodyDiffEditor = screen.getByRole("textbox", { name: "正文" }).closest(".draft-cm-diff-field");
    expect(bodyDiffEditor).not.toBeNull();
    const mixedLines = [...(bodyDiffEditor as HTMLElement).querySelectorAll(".cm-line")].filter((line) => {
      const text = line.textContent ?? "";
      return text.includes("旧句") && text.includes("新句");
    });
    expect(mixedLines).toHaveLength(0);
  });

  it("progressively consumes the old body placeholder inside the merge editor when the new stream starts from different text", () => {
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

    const bodyTextbox = screen.getByRole("textbox", { name: "正文" });
    expect(getCodeMirrorText(bodyTextbox)).toBe("新的第一句。新的第二句。旧的第三句。");
    expect(screen.getByText("新的第一句。新的第二句")).toHaveClass("cm-changedText");
    expect(screen.queryByText("旧的第一句。旧的第二句。旧的第三句。")).not.toBeInTheDocument();
  });

  it("uses the image prompt merge editor once image text is arriving", () => {
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

    const bodyTextbox = screen.getByRole("textbox", { name: "正文" });
    const imagePromptTextbox = screen.getByRole("textbox", { name: "配图提示" });
    expect(getCodeMirrorText(bodyTextbox)).toBe("旧正文新增句");
    expect(getCodeMirrorText(imagePromptTextbox)).toBe("正在生成的配图提示");
    expect(screen.getByText("新增句")).toHaveClass("cm-changedText");
    expect(screen.getByText("正在生成的配图提示")).toHaveClass("cm-changedText");
    expect(screen.queryByLabelText("正在生成到这里")).not.toBeInTheDocument();
  });

  it("does not render hashtags with a CodeMirror diff field during streaming", () => {
    render(
      <LiveDraft
        draft={{ title: "旧标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    expect(screen.queryByRole("textbox", { name: "话题" })).not.toBeInTheDocument();
    expect(screen.getByText("#旧")).toHaveClass("draft-diff-token--removed");
    expect(screen.getByText("#新")).toHaveClass("draft-diff-token--added");
  });

  it("keeps completed body diff stable in CodeMirror when the image prompt stream has started", () => {
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

    expect(getCodeMirrorText(screen.getByRole("textbox", { name: "正文" }))).toBe("旧正文新增句");
    expect(getCodeMirrorText(screen.getByRole("textbox", { name: "配图提示" }))).toBe("旧图");
    expect(screen.getByText("旧正文新增句")).toHaveClass("cm-changedText");
    expect(screen.queryByLabelText("正在生成到这里")).not.toBeInTheDocument();
  });

  it("updates the read-only merge editor as streaming text changes", () => {
    const previousDraft = {
      title: "旧标题",
      body: "已经生成的开头。还没有生成到的旧内容。",
      hashtags: ["#旧"],
      imagePrompt: "旧图"
    };
    const { rerender } = render(
      <LiveDraft
        draft={{ title: "旧标题", body: "已经生成的开头。", hashtags: ["#旧"], imagePrompt: "旧图" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={previousDraft}
        publishPackage={null}
      />
    );

    const bodyTextbox = screen.getByRole("textbox", { name: "正文" });
    expect(getCodeMirrorText(bodyTextbox)).toBe("已经生成的开头。还没有生成到的旧内容。");

    rerender(
      <LiveDraft
        draft={{ title: "旧标题", body: "已经生成的开头。新写出来的一句", hashtags: ["#旧"], imagePrompt: "旧图" }}
        isBusy
        isLiveDiff
        isLiveDiffStreaming
        previousDraft={previousDraft}
        publishPackage={null}
      />
    );

    expect(getCodeMirrorText(bodyTextbox)).toBe("已经生成的开头。新写出来的一句旧内容。");
  });

  it("uses CodeMirror diff field layout for streaming diffs", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const fieldRule = css.match(/\.draft-cm-diff-field\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const labelRule = css.match(/\.draft-cm-diff-field__label\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
    const titleRule = css.match(/\.draft-cm-diff-field--title \.cm-editor\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(fieldRule).toContain("display: grid");
    expect(fieldRule).toContain("gap: 6px");
    expect(labelRule).toContain("font-weight: 850");
    expect(titleRule).toContain("font-weight: 850");
  });

  it("lets generated diff review be dismissed after streaming completes", async () => {
    const onDismissLiveDiff = vi.fn();
    const onSave = vi.fn();

    render(
      <LiveDraft
        draft={{ title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
        isBusy={false}
        isEditable
        isLiveDiff
        onDismissLiveDiff={onDismissLiveDiff}
        onSave={onSave}
        previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    const bodyDiffEditor = screen.getByRole("textbox", { name: "正文" }).closest(".draft-cm-diff-field");
    expect(bodyDiffEditor).not.toBeNull();
    expect(within(bodyDiffEditor as HTMLElement).getByText(/新增句/)).toBeInTheDocument();
    expect(screen.queryByLabelText("正在生成到这里")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "关闭对比" }));

    expect(onDismissLiveDiff).toHaveBeenCalledTimes(1);
  });

  it("keeps completed generated diff review read-only until editing is requested", async () => {
    const onSave = vi.fn();

    render(
      <LiveDraft
        draft={{ title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
        isBusy={false}
        isEditable
        isLiveDiff
        onDismissLiveDiff={vi.fn()}
        onSave={onSave}
        previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    const bodyTextbox = within(screen.getByRole("textbox", { name: "正文" }).closest(".draft-cm-diff-field") as HTMLElement).getByRole(
      "textbox",
      { name: "正文" }
    );
    expect(bodyTextbox).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));

    const editableBodyTextbox = within(screen.getByRole("textbox", { name: "正文" }).closest(".draft-cm-diff-field") as HTMLElement).getByRole(
      "textbox",
      { name: "正文" }
    );
    expect(editableBodyTextbox).toHaveAttribute("contenteditable", "true");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出草稿" })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("opens selected text actions from completed generated diff review while it is read-only", async () => {
    const onRewriteSelection = vi.fn().mockResolvedValue(undefined);

    render(
      <LiveDraft
        draft={{ title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
        isBusy={false}
        isEditable
        isLiveDiff
        onDismissLiveDiff={vi.fn()}
        onRewriteSelection={onRewriteSelection}
        onSave={vi.fn()}
        previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    const bodyDiffEditor = screen.getByRole("textbox", { name: "正文" }).closest(".draft-cm-diff-field");
    expect(bodyDiffEditor).not.toBeNull();
    const bodyTextbox = within(bodyDiffEditor as HTMLElement).getByRole("textbox", { name: "正文" });
    expect(bodyTextbox).toHaveAttribute("contenteditable", "false");

    selectTextInside(within(bodyDiffEditor as HTMLElement).getByText(/新增句/), "新增句");
    fireEvent.mouseUp(bodyTextbox);

    expect(screen.getByRole("toolbar", { name: "选中文本操作" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "更具体");
    await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

    expect(onRewriteSelection).toHaveBeenCalledWith({
      draft: { title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" },
      field: "body",
      instruction: "更具体",
      selectedText: "新增句",
      selectionStart: 3,
      selectionEnd: 6
    });
  });

  it("opens selected text actions from completed generated diff review after editing is requested", async () => {
    const onRewriteSelection = vi.fn().mockResolvedValue(undefined);

    render(
      <LiveDraft
        draft={{ title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
        isBusy={false}
        isEditable
        isLiveDiff
        onDismissLiveDiff={vi.fn()}
        onRewriteSelection={onRewriteSelection}
        onSave={vi.fn()}
        previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));

    const bodyDiffEditor = screen.getByRole("textbox", { name: "正文" }).closest(".draft-cm-diff-field");
    expect(bodyDiffEditor).not.toBeNull();
    const bodyTextbox = within(bodyDiffEditor as HTMLElement).getByRole("textbox", { name: "正文" });
    expect(bodyTextbox).toHaveAttribute("contenteditable", "true");

    selectCodeMirrorRange(bodyTextbox, 3, 6);
    fireEvent.mouseUp(bodyTextbox);

    expect(screen.getByRole("toolbar", { name: "选中文本操作" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "引用" }));
    await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "更具体");
    await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

    expect(onRewriteSelection).toHaveBeenCalledWith({
      draft: { title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" },
      field: "body",
      instruction: "更具体",
      selectedText: "新增句",
      selectionStart: 3,
      selectionEnd: 6
    });
  });

  it("lets completed generated diff review be edited after leaving read-only mode", async () => {
    const onDismissLiveDiff = vi.fn();
    const onSave = vi.fn();

    render(
      <LiveDraft
        draft={{ title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
        isBusy={false}
        isEditable
        isLiveDiff
        onDismissLiveDiff={onDismissLiveDiff}
        onSave={onSave}
        previousDraft={{ title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" }}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));

    const bodyDiffEditor = screen.getByRole("textbox", { name: "正文" }).closest(".draft-cm-diff-field");
    expect(bodyDiffEditor).not.toBeNull();
    const bodyTextbox = within(bodyDiffEditor as HTMLElement).getByRole("textbox", { name: "正文" });
    expect(bodyTextbox).toHaveAttribute("contenteditable", "true");
    expect(bodyTextbox.closest(".cm-editor")).toHaveClass("cm-merge-b");
    expect(within(bodyDiffEditor as HTMLElement).getByText(/新增句/)).toBeInTheDocument();
    expect((bodyDiffEditor as HTMLElement).querySelector(".cm-changedText, .cm-insertedLine, .cm-changedLine")).not.toBeNull();

    setCodeMirrorText(screen.getByRole("textbox", { name: "标题" }), "我改后的标题");
    setCodeMirrorText(bodyTextbox, "旧正文新增句，我又改了一刀。");
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(onSave).toHaveBeenCalledWith({
      title: "我改后的标题",
      body: "旧正文新增句，我又改了一刀。",
      hashtags: ["#新"],
      imagePrompt: "新图"
    });
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

    expect(document.querySelector(".draft-editor textarea")).toBeNull();
    expect(screen.getByRole("textbox", { name: "正文" })).toHaveAttribute("contenteditable", "false");
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.getByText("新增句")).toHaveClass("cm-changedText");
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

  it("shows the parent diff toggle even if legacy publish package data is present", () => {
    render(
      <LiveDraft
        draft={{ title: "Draft", body: "Draft body", hashtags: ["#draft"], imagePrompt: "draft image" }}
        isBusy={false}
        previousDraft={{ title: "Parent", body: "Parent body", hashtags: ["#parent"], imagePrompt: "parent image" }}
        publishPackage={{ title: "Final", body: "Final body", hashtags: ["#AI"], imagePrompt: "glowing tree" }}
      />
    );

    expect(screen.getByRole("button", { name: "对比" })).toBeInTheDocument();
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

  it("keeps the publish assistant scrollable inside the draft panel", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const publishRule = css.match(/\.draft-publish-panel\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

    expect(publishRule).toContain("max-height: calc(100% - 66px)");
    expect(publishRule).toContain("overflow: auto");
  });

  it("opens a publish assistant with Weibo, Xiaohongshu, and Moments tabs", async () => {
    render(
      <LiveDraft
        draft={{
          title: "把复杂工作讲成一句人话",
          body: "先给对方一条主线，再补细节。",
          hashtags: ["产品思考", "#沟通效率"],
          imagePrompt: "一张干净的工作台"
        }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));

    expect(screen.getByRole("dialog", { name: "发布助手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "微博" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "小红书" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "朋友圈" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("微博版预览")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "微博发布文案" })).toHaveValue(
      "先给对方一条主线，再补细节。\n\n#产品思考# #沟通效率#"
    );

    await userEvent.click(screen.getByRole("button", { name: "小红书" }));

    expect(screen.getByRole("button", { name: "微博" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "小红书" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "朋友圈" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("小红书版预览")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "小红书标题" })).toHaveValue("把复杂工作讲成一句人话");
    expect(screen.getByRole("textbox", { name: "小红书正文" })).toHaveValue("先给对方一条主线，再补细节。\n\n#产品思考 #沟通效率");

    await userEvent.click(screen.getByRole("button", { name: "朋友圈" }));

    expect(screen.getByRole("button", { name: "微博" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "小红书" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "朋友圈" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("朋友圈版预览")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "朋友圈文案" })).toHaveValue("先给对方一条主线，再补细节。");
  });

  it("copies the edited Weibo text with double-hash topics", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <LiveDraft
        draft={{
          title: "标题",
          body: "正文第一句。\n正文第二句。",
          hashtags: ["产品思考", "#沟通效率"],
          imagePrompt: ""
        }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.getByRole("textbox", { name: "微博发布文案" })).toHaveValue(
      "正文第一句。\n正文第二句。\n\n#产品思考# #沟通效率#"
    );

    fireEvent.change(screen.getByRole("textbox", { name: "微博发布文案" }), {
      target: { value: "手动改过的微博文案\n\n#产品思考#" }
    });
    await userEvent.click(screen.getByRole("button", { name: "复制微博文案" }));

    expect(writeText).toHaveBeenCalledWith("手动改过的微博文案\n\n#产品思考#");
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  });

  it("offers Xiaohongshu-specific copy actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <LiveDraft
        draft={{ title: "小红书标题", body: "小红书正文", hashtags: ["生活观察"], imagePrompt: "封面图" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.queryByRole("button", { name: "复制标题" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "小红书" }));
    expect(screen.getByRole("textbox", { name: "小红书标题" })).toHaveValue("小红书标题");
    expect(screen.getByRole("textbox", { name: "小红书正文" })).toHaveValue("小红书正文\n\n#生活观察");

    fireEvent.change(screen.getByRole("textbox", { name: "小红书标题" }), {
      target: { value: "改过的小红书标题" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "小红书正文" }), {
      target: { value: "改过的小红书正文\n\n#生活观察" }
    });
    expect(screen.getByRole("button", { name: "复制小红书文案" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "复制标题" }));
    await userEvent.click(screen.getByRole("button", { name: "复制小红书文案" }));

    expect(writeText).toHaveBeenNthCalledWith(1, "改过的小红书标题");
    expect(writeText).toHaveBeenNthCalledWith(2, "改过的小红书正文\n\n#生活观察");
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制正文" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制话题" })).toBeInTheDocument();
  });

  it("copies the edited body-first Moments text without title or topics", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <LiveDraft
        draft={{
          title: "不会进入朋友圈",
          body: "朋友圈正文第一句。\n朋友圈正文第二句。",
          hashtags: ["产品思考", "#沟通效率"],
          imagePrompt: "生活化手机随拍"
        }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    await userEvent.click(screen.getByRole("button", { name: "朋友圈" }));

    const momentsText = screen.getByRole("textbox", { name: "朋友圈文案" });
    expect(momentsText).toHaveValue("朋友圈正文第一句。\n朋友圈正文第二句。");
    expect((momentsText as HTMLTextAreaElement).value).not.toContain("不会进入朋友圈");
    expect((momentsText as HTMLTextAreaElement).value).not.toContain("#产品思考");
    expect(screen.queryByRole("button", { name: "复制标题" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制话题" })).not.toBeInTheDocument();

    fireEvent.change(momentsText, {
      target: { value: "手动改过的朋友圈文案" }
    });
    await userEvent.click(screen.getByRole("button", { name: "复制朋友圈文案" }));

    expect(writeText).toHaveBeenCalledWith("手动改过的朋友圈文案");
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  });

  it("shows the image prompt in the publish assistant and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <LiveDraft
        draft={{ title: "标题", body: "正文", hashtags: ["#话题"], imagePrompt: "明亮桌面上的便签和手机" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));

    expect(screen.getByRole("textbox", { name: "配图提示" })).toHaveValue("明亮桌面上的便签和手机");
    await userEvent.click(screen.getByRole("button", { name: "复制配图提示" }));

    expect(writeText).toHaveBeenCalledWith("明亮桌面上的便签和手机");
  });

  it("shows platform-specific publish checks without blocking copy", async () => {
    render(
      <LiveDraft draft={{ title: "", body: "只有正文", hashtags: [], imagePrompt: "" }} isBusy={false} publishPackage={null} />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));

    expect(screen.getByText(/微博字数约/)).toBeInTheDocument();
    expect(screen.queryByText("标题来自正文摘要")).not.toBeInTheDocument();
    expect(screen.getByText("缺少话题")).toBeInTheDocument();
    expect(screen.getByText("微博可以不配图")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "小红书" }));

    expect(screen.getByText("标题来自正文摘要")).toBeInTheDocument();
    expect(screen.getByText("缺少话题")).toBeInTheDocument();
    expect(screen.getByText("建议补充配图提示")).toBeInTheDocument();
  });

  it("shows Moments publish checks from edited text and optional image prompt", async () => {
    render(
      <LiveDraft
        draft={{ title: "标题", body: "朋友圈长文".repeat(150), hashtags: ["#话题"], imagePrompt: "" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    await userEvent.click(screen.getByRole("button", { name: "朋友圈" }));

    expect(screen.getByText(/朋友圈字数约/)).toBeInTheDocument();
    expect(screen.getByText("正文已生成")).toBeInTheDocument();
    expect(screen.getByText("朋友圈长文可能需要收紧")).toBeInTheDocument();
    expect(screen.getByText("朋友圈可以不配图")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "朋友圈文案" }), {
      target: { value: "" }
    });

    expect(screen.getByText("朋友圈字数约 0")).toBeInTheDocument();
    expect(screen.getByText("缺少正文")).toBeInTheDocument();
  });

  it("closes the publish assistant when editing starts or the draft changes", async () => {
    const { rerender } = render(
      <LiveDraft
        draft={{ title: "标题", body: "正文", hashtags: ["#话题"], imagePrompt: "画面" }}
        isBusy={false}
        isEditable
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.getByRole("dialog", { name: "发布助手" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.queryByRole("dialog", { name: "发布助手" })).not.toBeInTheDocument();

    rerender(
      <LiveDraft
        draft={{ title: "标题", body: "正文", hashtags: ["#话题"], imagePrompt: "画面" }}
        isBusy={false}
        isEditable
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    rerender(
      <LiveDraft
        draft={{ title: "新标题", body: "新正文", hashtags: ["#新话题"], imagePrompt: "新画面" }}
        isBusy={false}
        isEditable
        publishPackage={null}
      />
    );

    expect(screen.queryByRole("dialog", { name: "发布助手" })).not.toBeInTheDocument();
  });

  it("shows a clipboard error when publish copy fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <LiveDraft
        draft={{ title: "标题", body: "正文", hashtags: ["#话题"], imagePrompt: "画面" }}
        isBusy={false}
        publishPackage={null}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    await userEvent.click(screen.getByRole("button", { name: "复制微博文案" }));

    expect(screen.getByRole("status")).toHaveTextContent("复制失败，请手动选中文案复制。");
  });

  it("renders empty-state actions in the middle of the draft area instead of the header", () => {
    const { container } = render(
      <LiveDraft
        draft={null}
        emptyStateActions={<button type="button">重试生成</button>}
        headerActions={<button type="button">技能</button>}
        isBusy={false}
        publishPackage={null}
      />
    );

    const headerActions = container.querySelector(".draft-panel__actions");
    const emptyState = container.querySelector(".draft-empty-state");
    expect(headerActions).not.toContainElement(screen.getByRole("button", { name: "重试生成" }));
    expect(emptyState).toContainElement(screen.getByRole("button", { name: "重试生成" }));
    expect(emptyState).toHaveTextContent("开始创作后，草稿会在这里同步更新。");
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
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(onSave).toHaveBeenCalledWith({
      title: "Draft",
      body: "Edited body",
      hashtags: ["#draft"],
      imagePrompt: "draft image"
    });
  });

  it("exits the current draft editor without saving local edits", async () => {
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
    await userEvent.type(screen.getByLabelText("正文"), "Unsaved body");
    await userEvent.click(screen.getByRole("button", { name: "退出草稿" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("正文")).not.toBeInTheDocument();
    expect(screen.getByText("Draft body")).toBeInTheDocument();
  });

  it("lets a comparison diff editor be changed and saved without entering a separate editor", async () => {
    const onCancelComparison = vi.fn();
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
        onCancelComparison={onCancelComparison}
        onSave={onSave}
        publishPackage={null}
      />
    );

    expect(screen.queryByRole("button", { name: "编辑对比" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /选择差异/ })).not.toBeInTheDocument();

    const bodyTextbox = screen.getByRole("textbox", { name: "正文" });
    expect(bodyTextbox.closest(".cm-editor")).toHaveClass("cm-merge-b");
    expect(screen.getByText("新增")).toHaveClass("cm-changedText");

    setCodeMirrorText(bodyTextbox, "保留");
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(onSave).toHaveBeenCalledWith({
      title: "新标题",
      body: "保留",
      hashtags: ["#新"],
      imagePrompt: "新图"
    });
    expect(onCancelComparison).toHaveBeenCalledTimes(1);
  });

  it("exits a comparison draft editor without saving local edits", async () => {
    const onCancelComparison = vi.fn();
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
        onCancelComparison={onCancelComparison}
        onSave={onSave}
        publishPackage={null}
      />
    );

    const bodyTextbox = screen.getByRole("textbox", { name: "正文" });
    setCodeMirrorText(bodyTextbox, "我临时改了一版");

    await userEvent.click(screen.getByRole("button", { name: "退出草稿" }));

    expect(onCancelComparison).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps editable comparisons inside CodeMirror instead of opening token popovers", () => {
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

    expect(screen.getByRole("textbox", { name: "正文" }).closest(".cm-editor")).toHaveClass("cm-merge-b");
    expect(screen.queryByRole("button", { name: /选择差异/ })).not.toBeInTheDocument();
    expect(document.querySelector(".draft-diff-token-popover")).not.toBeInTheDocument();
  });

  it("opens selected text actions from an editable comparison body selection near the selected text", async () => {
    const coordsSpy = vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation((position) => {
      const left = position <= 3 ? 520 : 580;
      return {
        bottom: 220,
        height: 20,
        left,
        right: left,
        top: 200,
        width: 0,
        x: left,
        y: 200,
        toJSON: () => ({})
      } as DOMRect;
    });
    const onRewriteSelection = vi.fn().mockResolvedValue(undefined);

    try {
      render(
        <LiveDraft
          comparisonDrafts={{
            from: { title: "旧标题", body: "旧正文", hashtags: ["#旧"], imagePrompt: "旧图" },
            to: { title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }
          }}
          comparisonLabels={{ from: "第 1 轮 · 旧", to: "第 2 轮 · 新" }}
          draft={{ title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" }}
          isBusy={false}
          isComparisonMode
          isEditable
          onCancelComparison={vi.fn()}
          onRewriteSelection={onRewriteSelection}
          onSave={vi.fn()}
          publishPackage={null}
        />
      );

      const bodyTextbox = screen.getByRole("textbox", { name: "正文" });
      selectCodeMirrorRange(bodyTextbox, 3, 5);
      fireEvent.mouseUp(bodyTextbox);

      const toolbar = screen.getByRole("toolbar", { name: "选中文本操作" });
      expect(toolbar).toHaveStyle({ left: "479px", top: "228px" });

      await userEvent.click(screen.getByRole("button", { name: "引用" }));
      await userEvent.type(screen.getByRole("textbox", { name: "修改要求" }), "更具体");
      await userEvent.click(screen.getByRole("button", { name: "发送修改" }));

      expect(onRewriteSelection).toHaveBeenCalledWith({
        draft: { title: "新标题", body: "旧正文新增句", hashtags: ["#新"], imagePrompt: "新图" },
        field: "body",
        instruction: "更具体",
        selectedText: "新增",
        selectionStart: 3,
        selectionEnd: 5
      });
    } finally {
      coordsSpy.mockRestore();
    }
  });
});

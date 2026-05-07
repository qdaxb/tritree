import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftManagementPanel } from "./DraftManagementPanel";

const timestamp = "2026-05-06T00:00:00.000Z";

type TestDraft = {
  id: string;
  title: string;
  status: "active" | "archived";
  currentNodeId: string | null;
  currentRoundIndex: number | null;
  bodyExcerpt: string;
  bodyLength: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body
  };
}

function deferredResponse<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("DraftManagementPanel", () => {
  let drafts: TestDraft[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    drafts = [
      {
        id: "session-1",
        title: "第一篇草稿",
        status: "active",
        currentNodeId: "node-2",
        currentRoundIndex: 2,
        bodyExcerpt: "这是一段正在展开的正文。",
        bodyLength: 128,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "session-2",
        title: "空白念头",
        status: "active",
        currentNodeId: null,
        currentRoundIndex: null,
        bodyExcerpt: "",
        bodyLength: 0,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ];

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/sessions?view=active" && method === "GET") {
        return jsonResponse({ drafts });
      }

      if (url === "/api/sessions/session-1" && method === "PATCH") {
        const body = JSON.parse(init?.body as string) as { title: string };
        drafts = drafts.map((draft) =>
          draft.id === "session-1" ? { ...draft, title: body.title, updatedAt: "2026-05-06T01:00:00.000Z" } : draft
        );
        return jsonResponse({ draft: drafts.find((draft) => draft.id === "session-1") });
      }

      if (url === "/api/sessions/session-1" && method === "DELETE") {
        const draft = drafts.find((currentDraft) => currentDraft.id === "session-1");
        drafts = drafts.filter((currentDraft) => currentDraft.id !== "session-1");
        return jsonResponse({ draft: draft ? { ...draft, isArchived: true, status: "archived" } : undefined });
      }

      if (url === "/api/sessions/session-2" && method === "DELETE") {
        const draft = drafts.find((currentDraft) => currentDraft.id === "session-2");
        drafts = drafts.filter((currentDraft) => currentDraft.id !== "session-2");
        return jsonResponse({ draft: draft ? { ...draft, isArchived: true, status: "archived" } : undefined });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders draft summaries with open, rename, archive, and top actions", async () => {
    render(<DraftManagementPanel />);

    expect(await screen.findByText("第一篇草稿")).toBeInTheDocument();
    expect(screen.getByText("空白念头")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回创作" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "新念头" })).toHaveAttribute("href", "/?new=1");
    expect(screen.getByText("这是一段正在展开的正文。")).toBeInTheDocument();
    expect(screen.getByText("暂无正文。")).toBeInTheDocument();
    expect(screen.getByText("第 2 轮")).toBeInTheDocument();
    expect(screen.getByText("未开始分支")).toBeInTheDocument();
    expect(screen.getByText("约 128 字")).toBeInTheDocument();

    const firstRow = screen.getByRole("article", { name: "第一篇草稿" });
    expect(within(firstRow).getByRole("link", { name: "打开" })).toHaveAttribute("href", "/?sessionId=session-1");
    expect(within(firstRow).getByRole("button", { name: "重命名" })).toBeInTheDocument();
    expect(within(firstRow).getByRole("button", { name: "归档" })).toBeInTheDocument();
  });

  it("renames a draft with a trimmed title and refreshes the row", async () => {
    render(<DraftManagementPanel />);

    const firstRow = await screen.findByRole("article", { name: "第一篇草稿" });
    await userEvent.click(within(firstRow).getByRole("button", { name: "重命名" }));
    await userEvent.clear(within(firstRow).getByLabelText("新标题"));
    await userEvent.type(within(firstRow).getByLabelText("新标题"), "  新标题  ");
    await userEvent.click(within(firstRow).getByRole("button", { name: "保存名称" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sessions/session-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ title: "新标题" })
        })
      )
    );
    expect(await screen.findByRole("article", { name: "新标题" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存名称" })).not.toBeInTheDocument();
  });

  it("validates an empty rename title before submitting", async () => {
    render(<DraftManagementPanel />);

    const firstRow = await screen.findByRole("article", { name: "第一篇草稿" });
    await userEvent.click(within(firstRow).getByRole("button", { name: "重命名" }));
    await userEvent.clear(within(firstRow).getByLabelText("新标题"));
    await userEvent.type(within(firstRow).getByLabelText("新标题"), "   ");
    await userEvent.click(within(firstRow).getByRole("button", { name: "保存名称" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("草稿标题不能为空。");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sessions/session-1", expect.objectContaining({ method: "PATCH" }));
  });

  it("archives drafts and shows the empty state when none remain", async () => {
    render(<DraftManagementPanel />);

    const firstRow = await screen.findByRole("article", { name: "第一篇草稿" });
    await userEvent.click(within(firstRow).getByRole("button", { name: "归档" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1", expect.objectContaining({ method: "DELETE" }))
    );
    expect(screen.queryByText("第一篇草稿")).not.toBeInTheDocument();

    const secondRow = screen.getByRole("article", { name: "空白念头" });
    await userEvent.click(within(secondRow).getByRole("button", { name: "归档" }));

    expect(await screen.findByText("还没有草稿。开始一个新念头后会出现在这里。")).toBeInTheDocument();
  });

  it("shows an inline alert when loading drafts fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "服务暂时不可用。" }, false));

    render(<DraftManagementPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("服务暂时不可用。");
    expect(screen.queryByText("还没有草稿。开始一个新念头后会出现在这里。")).not.toBeInTheDocument();
  });

  it("disables all draft mutation controls while an archive is pending", async () => {
    const archiveResponse = deferredResponse<ReturnType<typeof jsonResponse>>();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/sessions?view=active" && method === "GET") {
        return jsonResponse({ drafts });
      }
      if (url === "/api/sessions/session-1" && method === "DELETE") {
        return archiveResponse.promise;
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    render(<DraftManagementPanel />);

    const firstRow = await screen.findByRole("article", { name: "第一篇草稿" });
    const secondRow = screen.getByRole("article", { name: "空白念头" });

    await userEvent.click(within(firstRow).getByRole("button", { name: "归档" }));

    await waitFor(() => expect(within(firstRow).getByRole("button", { name: "归档" })).toBeDisabled());
    expect(within(secondRow).getByRole("button", { name: "重命名" })).toBeDisabled();
    expect(within(secondRow).getByRole("button", { name: "归档" })).toBeDisabled();

    archiveResponse.resolve(jsonResponse({ draft: { ...drafts[0], isArchived: true, status: "archived" } }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "第一篇草稿" })).not.toBeInTheDocument());
    expect(within(secondRow).getByRole("button", { name: "重命名" })).not.toBeDisabled();
    expect(within(secondRow).getByRole("button", { name: "归档" })).not.toBeDisabled();
  });

  it("shows the fallback load error when the request rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));

    render(<DraftManagementPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("草稿加载失败。");
  });
});

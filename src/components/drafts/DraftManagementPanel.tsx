"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { type DraftSummary } from "@/lib/domain";

type DraftsResponse = {
  drafts?: DraftSummary[];
  draft?: DraftSummary;
  error?: string;
};

async function readJson(response: Response): Promise<DraftsResponse> {
  try {
    return (await response.json()) as DraftsResponse;
  } catch {
    return {};
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function DraftManagementPanel() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);

  useEffect(() => {
    async function loadDrafts() {
      setIsLoading(true);
      try {
        const response = await fetch("/api/sessions?view=active");
        const data = await readJson(response);
        if (!response.ok) {
          setMessage(data.error ?? "草稿加载失败。");
          return;
        }
        setDrafts(data.drafts ?? []);
      } catch {
        setMessage("草稿加载失败。");
      } finally {
        setIsLoading(false);
      }
    }

    void loadDrafts();
  }, []);

  function startRename(draft: DraftSummary) {
    setMessage("");
    setEditingDraftId(draft.id);
    setEditingTitle(draft.title);
  }

  function cancelRename() {
    setEditingDraftId(null);
    setEditingTitle("");
    setMessage("");
  }

  async function submitRename(event: FormEvent<HTMLFormElement>, draftId: string) {
    event.preventDefault();
    const title = editingTitle.trim();
    setMessage("");

    if (!title) {
      setMessage("草稿标题不能为空。");
      return;
    }

    setBusyDraftId(draftId);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(draftId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      const data = await readJson(response);
      if (!response.ok || !data.draft) {
        setMessage(data.error ?? "无法重命名草稿。");
        return;
      }
      setDrafts((current) => current.map((draft) => (draft.id === draftId ? data.draft! : draft)));
      setEditingDraftId(null);
      setEditingTitle("");
    } catch {
      setMessage("无法重命名草稿。");
    } finally {
      setBusyDraftId(null);
    }
  }

  async function archiveDraft(draftId: string) {
    setMessage("");
    setBusyDraftId(draftId);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(draftId)}`, {
        method: "DELETE"
      });
      const data = await readJson(response);
      if (!response.ok) {
        setMessage(data.error ?? "无法归档草稿。");
        return;
      }
      setDrafts((current) => current.filter((draft) => draft.id !== draftId));
      if (editingDraftId === draftId) {
        setEditingDraftId(null);
        setEditingTitle("");
      }
    } catch {
      setMessage("无法归档草稿。");
    } finally {
      setBusyDraftId(null);
    }
  }

  return (
    <main className="drafts-page">
      <section className="drafts-panel" aria-labelledby="drafts-title">
        <div className="drafts-panel__header">
          <div>
            <p>Tritree</p>
            <h1 id="drafts-title">我的草稿</h1>
          </div>
          <div className="drafts-panel__actions">
            <Link className="drafts-link-button" href="/">
              返回创作
            </Link>
            <Link className="drafts-primary-link" href="/?new=1">
              新念头
            </Link>
          </div>
        </div>

        <div className="drafts-list-header">
          <h2>未归档草稿</h2>
          <span>{isLoading ? "加载中" : `${drafts.length} 篇草稿`}</span>
        </div>

        {message ? (
          <p className="drafts-alert" role="alert">
            {message}
          </p>
        ) : null}

        <div className="drafts-list">
          {!isLoading && drafts.length === 0 ? (
            <p className="drafts-empty">还没有草稿。开始一个新念头后会出现在这里。</p>
          ) : null}

          {drafts.map((draft) => {
            const isEditing = editingDraftId === draft.id;
            const isBusy = busyDraftId === draft.id;
            return (
              <article className="drafts-row" aria-label={draft.title} key={draft.id}>
                <div className="drafts-row__main">
                  <div>
                    <h2>{draft.title}</h2>
                    <p>{draft.bodyExcerpt || "暂无正文。"}</p>
                  </div>
                  <div className="drafts-row__meta">
                    <span>更新于 {formatDate(draft.updatedAt)}</span>
                    <span>{draft.currentRoundIndex === null ? "未开始分支" : `第 ${draft.currentRoundIndex} 轮`}</span>
                    <span>约 {draft.bodyLength} 字</span>
                  </div>
                </div>

                {isEditing ? (
                  <form className="drafts-rename-form" onSubmit={(event) => void submitRename(event, draft.id)}>
                    <label>
                      <span>新标题</span>
                      <input
                        autoComplete="off"
                        autoFocus
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                      />
                    </label>
                    <button disabled={isBusy} type="submit">
                      保存名称
                    </button>
                    <button disabled={isBusy} type="button" onClick={cancelRename}>
                      取消
                    </button>
                  </form>
                ) : null}

                <div className="drafts-row__actions">
                  <Link className="drafts-link-button" href={`/?sessionId=${encodeURIComponent(draft.id)}`}>
                    打开
                  </Link>
                  <button disabled={isBusy} type="button" onClick={() => startRename(draft)}>
                    重命名
                  </button>
                  <button disabled={isBusy} type="button" onClick={() => void archiveDraft(draft.id)}>
                    归档
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

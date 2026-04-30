"use client";

import { useEffect, useMemo, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { RootMemorySetup } from "@/components/root-memory/RootMemorySetup";
import { SkillLibraryPanel } from "@/components/skills/SkillLibraryPanel";
import { SkillPicker } from "@/components/skills/SkillPicker";
import {
  ChatStreamEventSchema,
  type ChatStreamEvent,
  type ConversationNode,
  type ConversationSource,
  type RootMemory,
  type RootPreferences,
  type SessionState,
  type Skill,
  type SkillUpsert,
  type SuggestedUserMove
} from "@/lib/domain";
import { createNdjsonParser } from "@/lib/stream/ndjson";

type LoadState = "loading" | "root" | "ready" | "error";
type RootSetupDefaults = { seed: string; enabledSkillIds?: string[] };
type SessionResponse = { state?: SessionState | null; conversationNodes?: ConversationNode[]; error?: string };
type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
type ActiveSuggestions = {
  nodeId: string;
  suggestions: SuggestedUserMove[];
} | null;

const preferenceText: Record<string, string> = {
  Product: "产品",
  Work: "工作",
  "Life observation": "生活观察",
  Learning: "学习",
  Creation: "创作",
  Sharp: "锋利",
  Warm: "温暖",
  Humorous: "幽默",
  Calm: "平静",
  Sincere: "真诚",
  "Story-driven": "故事型",
  "Opinion-driven": "观点型",
  "Tutorial-like": "教程型",
  Fragmentary: "碎片灵感",
  "Long-form": "长文",
  Practitioner: "实践者",
  Observer: "观察者",
  Expert: "专家",
  Friend: "朋友",
  Documentarian: "记录者"
};

function translatePreference(value: string) {
  return preferenceText[value] ?? value;
}

function formatRootSummary(rootMemory: RootMemory | null) {
  if (!rootMemory) return "";
  if (rootMemory.preferences.seed.trim()) return `Seed：${rootMemory.preferences.seed.trim()}`;

  const { preferences } = rootMemory;
  return [
    `领域：${preferences.domains.map(translatePreference).join("、")}`,
    `语气：${preferences.tones.map(translatePreference).join("、")}`,
    `表达：${preferences.styles.map(translatePreference).join("、")}`,
    `视角：${preferences.personas.map(translatePreference).join("、")}`
  ].join(" | ");
}

function apiKeyMessage(text: string) {
  return text.includes("Kimi API Key") || text.includes("KIMI_API_KEY")
    ? "请在 .env.local 添加 ANTHROPIC_AUTH_TOKEN 或 KIMI_API_KEY，然后重启开发服务器。"
    : text;
}

function sortConversationNodes(nodes: ConversationNode[]) {
  return [...nodes].sort((first, second) => first.createdAt.localeCompare(second.createdAt));
}

function latestPersistedNodeId(nodes: ConversationNode[]) {
  return sortConversationNodes(nodes).at(-1)?.id ?? null;
}

function latestAssistantSuggestions(nodes: ConversationNode[]): ActiveSuggestions {
  const sorted = sortConversationNodes(nodes);
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const node = sorted[index];
    if (node.role === "assistant" && node.metadata.suggestions?.length === 3) {
      return { nodeId: node.id, suggestions: node.metadata.suggestions };
    }
  }
  return null;
}

function updateAssistantSuggestions(nodes: ConversationNode[], nodeId: string, suggestions: SuggestedUserMove[]) {
  return nodes.map((node) =>
    node.id === nodeId
      ? {
          ...node,
          metadata: {
            ...node.metadata,
            suggestions
          }
        }
      : node
  );
}

function displayMessages(nodes: ConversationNode[], localMessages: LocalMessage[], streamingAssistant: string) {
  return [
    ...sortConversationNodes(nodes).map((node) => ({
      id: node.id,
      role: node.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: node.content,
      createdAt: node.createdAt
    })),
    ...localMessages,
    ...(streamingAssistant
      ? [
          {
            id: "streaming-assistant",
            role: "assistant" as const,
            content: streamingAssistant,
            createdAt: new Date().toISOString()
          }
        ]
      : [])
  ].filter((message) => message.role === "user" || message.role === "assistant");
}

export function TreeableApp() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [rootMemory, setRootMemory] = useState<RootMemory | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [conversationNodes, setConversationNodes] = useState<ConversationNode[]>([]);
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [activeSuggestions, setActiveSuggestions] = useState<ActiveSuggestions>(null);
  const [streamingAssistant, setStreamingAssistant] = useState("");
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [rootSetupDefaults, setRootSetupDefaults] = useState<RootSetupDefaults | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isSkillPanelOpen, setIsSkillPanelOpen] = useState(false);
  const [isSkillLibraryOpen, setIsSkillLibraryOpen] = useState(false);
  const [skillLibraryMessage, setSkillLibraryMessage] = useState("");

  useEffect(() => {
    void loadRoot();
  }, []);

  const enabledSkillIds = sessionState?.enabledSkillIds ?? [];
  const enabledSkills: Skill[] = (sessionState?.enabledSkills ?? []).map((skill) => ({
    ...skill,
    defaultEnabled: skill.defaultEnabled ?? false,
    isArchived: skill.isArchived ?? false
  }));
  const messages = useMemo(
    () => displayMessages(conversationNodes, localMessages, streamingAssistant),
    [conversationNodes, localMessages, streamingAssistant]
  );

  async function loadRoot() {
    try {
      const skillsResponse = await fetch("/api/skills");
      const skillsData = (await skillsResponse.json()) as { skills?: Skill[]; error?: string };
      if (!skillsResponse.ok || !skillsData.skills) throw new Error(skillsData.error ?? "技能加载失败。");
      setSkills(skillsData.skills);

      const response = await fetch("/api/root-memory");
      if (!response.ok) throw new Error("Seed 加载失败。");
      const data = (await response.json()) as { rootMemory: RootMemory | null };
      if (!data.rootMemory?.preferences.seed.trim()) {
        setRootMemory(data.rootMemory);
        setLoadState("root");
        return;
      }

      const sessionResponse = await fetch("/api/sessions");
      const sessionData = (await sessionResponse.json()) as SessionResponse;
      if (!sessionResponse.ok) throw new Error(sessionData.error ?? "对话加载失败。");
      if (!sessionData.state) {
        setRootMemory(data.rootMemory);
        setLoadState("root");
        return;
      }

      setRootMemory(data.rootMemory);
      setSessionState(sessionData.state);
      setConversationNodes(sortConversationNodes(sessionData.conversationNodes ?? []));
      setActiveSuggestions(latestAssistantSuggestions(sessionData.conversationNodes ?? []));
      setLoadState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法加载 Seed。");
      setLoadState("error");
    }
  }

  async function saveRoot(payload: { preferences: RootPreferences; enabledSkillIds: string[] }) {
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/root-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.preferences)
      });
      if (!response.ok) throw new Error("Seed 保存失败。");
      const data = (await response.json()) as { rootMemory: RootMemory };
      setRootMemory(data.rootMemory);
      await requestNewSession(payload.enabledSkillIds);
      setLoadState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Seed 保存失败。");
    } finally {
      setIsBusy(false);
    }
  }

  async function requestNewSession(enabledSkillIds?: string[]) {
    const response = await fetch(
      "/api/sessions",
      enabledSkillIds
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabledSkillIds })
          }
        : { method: "POST" }
    );
    const data = (await response.json().catch(() => null)) as SessionResponse | null;
    if (!response.ok || !data?.state) {
      throw new Error(data?.error ?? "启动创作失败。");
    }

    setSessionState(data.state);
    setConversationNodes(sortConversationNodes(data.conversationNodes ?? []));
    setLocalMessages([]);
    setActiveSuggestions(latestAssistantSuggestions(data.conversationNodes ?? []));
    setStreamingAssistant("");
    setIsSkillPanelOpen(false);
    setIsSkillLibraryOpen(false);
  }

  async function startSession() {
    setIsBusy(true);
    setMessage("");
    try {
      await requestNewSession();
      setLoadState("ready");
    } catch (error) {
      const text = error instanceof Error ? error.message : "启动创作失败。";
      setMessage(apiKeyMessage(text));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveSessionSkills(skillIds: string[]) {
    if (!sessionState) return;
    setIsBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${sessionState.session.id}/skills`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledSkillIds: skillIds })
      });
      const data = (await response.json()) as { state?: SessionState; error?: string };
      if (!response.ok || !data.state) throw new Error(data.error ?? "技能保存失败。");
      setSessionState(data.state);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "技能保存失败。");
    } finally {
      setIsBusy(false);
    }
  }

  async function createLibrarySkill(skill: SkillUpsert) {
    setIsBusy(true);
    setSkillLibraryMessage("");
    try {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill)
      });
      const data = (await response.json()) as { skill?: Skill; error?: string };
      if (!response.ok || !data.skill) throw new Error(data.error ?? "技能保存失败。");
      setSkills((current) => [...current, data.skill!]);
      return true;
    } catch (error) {
      setSkillLibraryMessage(error instanceof Error ? error.message : "技能保存失败。");
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function updateLibrarySkill(skillId: string, skill: SkillUpsert) {
    setIsBusy(true);
    setSkillLibraryMessage("");
    try {
      const response = await fetch(`/api/skills/${skillId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill)
      });
      const data = (await response.json()) as { skill?: Skill; error?: string };
      if (!response.ok || !data.skill) throw new Error(data.error ?? "技能保存失败。");
      setSkills((current) => current.map((item) => (item.id === skillId ? data.skill! : item)));
      return data.skill;
    } catch (error) {
      setSkillLibraryMessage(error instanceof Error ? error.message : "技能保存失败。");
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  async function archiveLibrarySkill(skillId: string) {
    const skill = skills.find((item) => item.id === skillId);
    if (!skill || skill.isSystem) return;
    const archivedSkill = await updateLibrarySkill(skillId, {
      title: skill.title,
      category: skill.category,
      description: skill.description,
      prompt: skill.prompt,
      defaultEnabled: skill.defaultEnabled,
      isArchived: true
    });
    if (archivedSkill) {
      setSkills((current) => current.filter((item) => item.id !== skillId));
    }
  }

  function openSeedSetup(defaults: RootSetupDefaults | null = null) {
    setRootSetupDefaults(defaults);
    setLoadState("root");
    setMessage("");
    setInput("");
    setStreamingAssistant("");
    setActiveSuggestions(null);
    setIsSkillPanelOpen(false);
    setIsSkillLibraryOpen(false);
  }

  function restartFromCurrentSettings() {
    openSeedSetup({
      seed: rootMemory?.preferences.seed ?? sessionState?.rootMemory.preferences.seed ?? "",
      enabledSkillIds
    });
  }

  function returnToCurrentWork() {
    if (!sessionState) return;
    setLoadState("ready");
    setIsSkillPanelOpen(false);
    setIsSkillLibraryOpen(false);
    setMessage("");
  }

  async function submitCurrentInput() {
    await sendUserMessage({
      content: input,
      source: "user_typed",
      parentId: latestPersistedNodeId(conversationNodes)
    });
  }

  async function sendSuggestion(suggestion: SuggestedUserMove, nodeId: string) {
    await sendUserMessage({
      content: suggestion.message,
      parentId: nodeId,
      source: "suggestion_pick",
      suggestionId: suggestion.id,
      targetNodeId: nodeId
    });
  }

  async function sendUserMessage({
    content,
    parentId,
    source,
    suggestionId,
    targetNodeId
  }: {
    content: string;
    parentId: string | null;
    source: Extract<ConversationSource, "user_typed" | "suggestion_pick" | "custom_direction" | "user_edit">;
    suggestionId?: SuggestedUserMove["id"];
    targetNodeId?: string;
  }) {
    if (!sessionState || isBusy) return;
    const trimmed = content.trim();
    if (!trimmed) return;

    const localUserMessage = {
      id: `local-${Date.now()}`,
      role: "user" as const,
      content: trimmed,
      createdAt: new Date().toISOString()
    };

    setIsBusy(true);
    setMessage("");
    setInput("");
    setStreamingAssistant("");
    setActiveSuggestions(null);
    setLocalMessages((current) => [...current, localUserMessage]);

    try {
      const response = await fetch(`/api/sessions/${sessionState.session.id}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: trimmed,
          parentId,
          source,
          ...(suggestionId ? { suggestionId } : {}),
          ...(targetNodeId ? { targetNodeId } : {})
        })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "生成回复失败。");
      }
      if (!response.body) throw new Error("生成回复失败。");

      await readMessageStream(response);
    } catch (error) {
      const text = error instanceof Error ? error.message : "生成回复失败。";
      setMessage(apiKeyMessage(text));
    } finally {
      setStreamingAssistant("");
      setIsBusy(false);
    }
  }

  async function readMessageStream(response: Response) {
    if (!response.body) return;

    let streamError: string | null = null;
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    const throwStreamError = () => {
      if (!streamError) return;
      const text = streamError;
      streamError = null;
      throw new Error(text);
    };
    const parser = createNdjsonParser((value) => {
      const parsed = ChatStreamEventSchema.safeParse(value);
      if (!parsed.success) return;
      handleChatStreamEvent(parsed.data);
      if (parsed.data.type === "error") {
        streamError = parsed.data.error;
      }
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      throwStreamError();
    }

    parser.push(decoder.decode());
    throwStreamError();
    parser.flush();
    throwStreamError();
  }

  function handleChatStreamEvent(event: ChatStreamEvent) {
    switch (event.type) {
      case "text":
        setStreamingAssistant((current) => `${current}${event.text}`);
        break;
      case "assistant":
        setConversationNodes((current) => sortConversationNodes([...current, event.node]));
        setStreamingAssistant("");
        break;
      case "suggestions":
        setConversationNodes((current) => updateAssistantSuggestions(current, event.nodeId, event.suggestions));
        setActiveSuggestions({ nodeId: event.nodeId, suggestions: event.suggestions });
        break;
      case "done":
        setSessionState(event.state);
        break;
      case "error":
        break;
    }
  }

  if (loadState === "loading") return <main className="loading-screen">正在唤醒 Tritree...</main>;
  if (loadState === "root") {
    return (
      <>
        <RootMemorySetup
          initialSeed={rootSetupDefaults?.seed}
          initialSkillIds={rootSetupDefaults?.enabledSkillIds}
          message={message}
          onBack={sessionState ? returnToCurrentWork : undefined}
          onManageSkills={() => setIsSkillLibraryOpen(true)}
          onSubmit={saveRoot}
          isSaving={isBusy}
          skills={skills}
        />
        {isSkillLibraryOpen ? (
          <SkillLibraryPanel
            error={skillLibraryMessage}
            isSaving={isBusy}
            onArchive={(skillId) => void archiveLibrarySkill(skillId)}
            onClose={() => setIsSkillLibraryOpen(false)}
            onCreate={createLibrarySkill}
            onUpdate={async (skillId, value) => Boolean(await updateLibrarySkill(skillId, value))}
            skills={skills}
          />
        ) : null}
      </>
    );
  }
  if (loadState === "error") return <main className="loading-screen">{message}</main>;

  const startButtonLabel = isBusy && !sessionState ? "启动中" : sessionState ? "重新开始" : "开始创作";

  return (
    <main className="app-shell app-shell--chat">
      <header className="topbar">
        <div className="brand-mark" />
        <div>
          <strong>Tritree</strong>
          <span>{formatRootSummary(rootMemory)}</span>
        </div>
        <div className="topbar-actions">
          <button className="start-button" disabled={isBusy} onClick={() => openSeedSetup()} type="button">
            新念头
          </button>
          <button
            className="secondary-button"
            disabled={isBusy}
            onClick={sessionState ? restartFromCurrentSettings : startSession}
            type="button"
          >
            {startButtonLabel}
          </button>
        </div>
      </header>

      {isSkillLibraryOpen ? (
        <SkillLibraryPanel
          error={skillLibraryMessage}
          isSaving={isBusy}
          onArchive={(skillId) => void archiveLibrarySkill(skillId)}
          onClose={() => setIsSkillLibraryOpen(false)}
          onCreate={createLibrarySkill}
          onUpdate={async (skillId, value) => Boolean(await updateLibrarySkill(skillId, value))}
          skills={skills}
        />
      ) : null}

      <section aria-label="对话内容" className="chat-workspace">
        <header className="chat-workspace__header">
          <div>
            <p className="eyebrow">主对话</p>
            <h1>直接和 Tritree 写下去。</h1>
          </div>
          <button
            aria-expanded={isSkillPanelOpen}
            className="draft-skill-button"
            disabled={isBusy || !sessionState}
            onClick={() => {
              setIsSkillLibraryOpen(false);
              setIsSkillPanelOpen((open) => !open);
            }}
            type="button"
          >
            {enabledSkillIds.length} 个技能
          </button>
        </header>

        {isSkillPanelOpen && sessionState ? (
          <aside aria-label="本作品技能" className="draft-skill-panel chat-workspace__skills">
            <header className="draft-skill-panel__header">
              <div>
                <p className="eyebrow">本作品技能</p>
                <p className="draft-skill-panel__summary">已启用 {enabledSkillIds.length} 个</p>
              </div>
              <button
                className="secondary-button"
                disabled={isBusy}
                onClick={() => {
                  setIsSkillPanelOpen(false);
                  setIsSkillLibraryOpen(true);
                }}
                type="button"
              >
                管理技能库
              </button>
            </header>
            <SkillPicker disabled={isBusy} onChange={(ids) => void saveSessionSkills(ids)} selectedSkillIds={enabledSkillIds} skills={skills} />
          </aside>
        ) : null}

        <div className="chat-thread">
          {messages.length === 0 ? (
            <p className="chat-empty">先发一条消息，Tritree 会按当前技能和记忆继续写。</p>
          ) : (
            messages.map((item) => (
              <article className={`chat-message chat-message--${item.role}`} key={item.id}>
                <p>{item.content}</p>
              </article>
            ))
          )}
        </div>

        {activeSuggestions ? (
          <section aria-label="候选用户输入" className="chat-suggestions">
            {activeSuggestions.suggestions.map((suggestion) => (
              <button
                className="chat-suggestion"
                disabled={isBusy}
                key={suggestion.id}
                onClick={() => void sendSuggestion(suggestion, activeSuggestions.nodeId)}
                type="button"
                title={suggestion.message}
              >
                {suggestion.label}
              </button>
            ))}
          </section>
        ) : null}

        <form
          aria-label="发送消息"
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitCurrentInput();
          }}
        >
          <label className="chat-composer__field">
            <span>写给 Tritree</span>
            <textarea
              aria-label="写给 Tritree"
              disabled={isBusy || !sessionState}
              onChange={(event) => setInput(event.target.value)}
              placeholder="输入你想继续写、修改、查询或尝试的方向..."
              rows={3}
              value={input}
            />
          </label>
          <button className="primary-action chat-composer__send" disabled={isBusy || !input.trim()} type="submit">
            <SendHorizontal aria-hidden="true" size={18} strokeWidth={2.4} />
            发送
          </button>
        </form>
      </section>

      {message ? (
        <div className="toast" role="status">
          {message}
        </div>
      ) : null}
    </main>
  );
}

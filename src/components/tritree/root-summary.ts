import { getArtifactType } from "@/lib/artifacts";
import { DEFAULT_ARTIFACT_TYPE_ID, type RootMemory } from "@/lib/domain";

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

export function formatRootSummary(rootMemory: RootMemory | null) {
  if (!rootMemory) return "";
  const summary = rootMemory.summary.trim();
  const artifactType = getArtifactType(rootMemory.preferences.artifactTypeId);
  const summaryPrefix = artifactType.id === DEFAULT_ARTIFACT_TYPE_ID ? "" : `${artifactType.label} | `;
  if (summary) return `${summaryPrefix}${summary.replace(/\s*\n\s*/g, " | ")}`;
  if (rootMemory.preferences.seed.trim()) return `Seed：${rootMemory.preferences.seed.trim()}`;

  const { preferences } = rootMemory;
  return [
    `领域：${preferences.domains.map(translatePreference).join("、")}`,
    `语气：${preferences.tones.map(translatePreference).join("、")}`,
    `表达：${preferences.styles.map(translatePreference).join("、")}`,
    `视角：${preferences.personas.map(translatePreference).join("、")}`
  ].join(" | ");
}

export function apiKeyMessage(text: string) {
  if (text.includes("OPENAI_API_KEY") || text.includes("OPENAI_AUTH_TOKEN")) {
    return "请在 .env.local 添加 OPENAI_API_KEY，然后重启开发服务器。";
  }

  return text.includes("Kimi API Key") || text.includes("KIMI_API_KEY")
    ? "请在 .env.local 添加 ANTHROPIC_AUTH_TOKEN、KIMI_API_KEY 或 OPENAI_API_KEY，然后重启开发服务器。"
    : text;
}

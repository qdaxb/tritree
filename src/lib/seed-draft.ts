import type { Draft } from "@/lib/domain";

export const SEED_DRAFT_PLACEHOLDER_TITLE = "种子念头";

export function createSeedDraft(seed: string): Draft {
  return {
    title: deriveSeedTitle(seed),
    body: seed,
    hashtags: [],
    imagePrompt: ""
  };
}

export function resolveDraftTitle(title: string | undefined, body: string | undefined) {
  const trimmedTitle = title?.trim();
  if (trimmedTitle && trimmedTitle !== SEED_DRAFT_PLACEHOLDER_TITLE) return trimmedTitle;
  return deriveSeedTitle(body ?? "");
}

export function deriveSeedTitle(seed: string) {
  const normalized = seed.replace(/\s+/g, " ").trim();
  const [firstSegment = normalized] = normalized.split(/[。！？!?，,；;：:\n]/);
  const title = firstSegment.trim() || normalized;
  return Array.from(title).slice(0, 24).join("") || "未命名草稿";
}

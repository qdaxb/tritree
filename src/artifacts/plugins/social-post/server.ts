import type { ArtifactPluginServer } from "@/artifacts/types";
import {
  assertSocialPostSelectionMatches,
  replaceSocialPostSelection,
  SocialPostRewriteSelectionInputSchema
} from "./actions";
import { socialPostManifest } from "./manifest";
import { SocialPostPayloadSchema, type SocialPostPayload } from "./schema";
import { rewriteSelectedSocialPostText } from "./selection-rewrite";

export const socialPostPlugin: ArtifactPluginServer<SocialPostPayload> = {
  ...socialPostManifest,
  payloadSchema: SocialPostPayloadSchema,
  aiOutputSchema: SocialPostPayloadSchema,
  createSeedPayload(input) {
    const body = input.seed.trim();
    return body ? { title: "种子念头", body, hashtags: [], imagePrompt: "" } : null;
  },
  promptInstructions() {
    return [
      "Artifact type: social-post content.",
      "Output a JSON payload with title, body, hashtags, and imagePrompt fields.",
      "User-facing text must be Simplified Chinese by default.",
      "hashtags must be a string array, and imagePrompt must be an empty string when there is no image prompt."
    ].join("\n");
  },
  normalizeAiOutput(output) {
    return SocialPostPayloadSchema.parse(output);
  },
  async handleAction({ artifact, input, sessionState }) {
    const payload = SocialPostPayloadSchema.parse(artifact.payload);
    const rewriteInput = SocialPostRewriteSelectionInputSchema.parse(input);
    assertSocialPostSelectionMatches(payload, rewriteInput);
    const { replacementText } = await rewriteSelectedSocialPostText({
      currentPayload: payload,
      enabledSkills: sessionState.enabledSkills ?? [],
      field: rewriteInput.field,
      instruction: rewriteInput.instruction,
      learnedSummary: sessionState.rootMemory.learnedSummary,
      pathSummary: "",
      rootSummary: sessionState.rootMemory.summary,
      selectedText: rewriteInput.selectedText
    });

    return {
      payload: replaceSocialPostSelection(payload, { ...rewriteInput, replacementText }),
      sourceArtifactIds: [artifact.id]
    };
  },
  summarizeForDirector(payload) {
    return [
      `Title: ${payload.title || "Untitled"}`,
      `Body: ${payload.body}`,
      `Hashtags: ${payload.hashtags.join(", ") || "None"}`,
      `Image prompt: ${payload.imagePrompt || "None"}`
    ].join("\n");
  },
  summarizeForTree(payload) {
    return payload.title.trim() || Array.from(payload.body.trim()).slice(0, 24).join("") || "社媒内容";
  }
};

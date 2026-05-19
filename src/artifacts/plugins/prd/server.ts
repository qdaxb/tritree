import type { ArtifactPluginServer } from "@/artifacts/types";
import { prdManifest } from "./manifest";
import { PrdPayloadSchema, type PrdPayload } from "./schema";

export const prdPlugin: ArtifactPluginServer<PrdPayload> = {
  ...prdManifest,
  payloadSchema: PrdPayloadSchema,
  aiOutputSchema: PrdPayloadSchema,
  createSeedPayload(input) {
    const seed = input.seed.trim();
    return seed ? { title: "种子 PRD", markdown: seed } : null;
  },
  promptInstructions() {
    return [
      "Artifact type: PRD document.",
      "Output a JSON payload with title and markdown fields.",
      "User-facing text must be Simplified Chinese by default.",
      "markdown must use Markdown sections and should prioritize background, goals, non-goals, users, requirements, metrics, risks, and open questions."
    ].join("\n");
  },
  normalizeAiOutput(output) {
    return PrdPayloadSchema.parse(output);
  },
  summarizeForDirector(payload) {
    return [`Document title: ${payload.title || "Untitled"}`, `PRD Markdown: ${payload.markdown}`].join("\n");
  },
  summarizeForTree(payload) {
    return payload.title.trim() || "PRD 文档";
  }
};

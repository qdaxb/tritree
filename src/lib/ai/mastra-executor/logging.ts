import type { SharedAgentContextInput } from "../mastra-context";
import { buildTreeArtifactInstructions, buildTreeNextStepInstructions, buildTreeOptionsInstructions, buildTreeTurnInstructions } from "../mastra-context";
import { logTritreeAiResponse, logTritreeAiStream } from "../debug-log";
import type { MastraConversationMessage, RuntimeSubmitTarget } from "./types";

export function logAiResponse(target: RuntimeSubmitTarget, mode: "generate" | "stream" | "stream-parse-failed", response: unknown) {
  logTritreeAiResponse("ai-response", target, {
    mode,
    response
  });
}

export function logAiStream(target: RuntimeSubmitTarget, event: "chunk" | "partial", value: unknown) {
  logTritreeAiStream("ai-stream", `${target}-${event}`, {
    value
  });
}

export function logMastraPrompt(
  kind: RuntimeSubmitTarget,
  context: SharedAgentContextInput,
  messages: MastraConversationMessage[]
) {
  const instructions =
    kind === "turn"
      ? buildTreeTurnInstructions(context)
      : kind === "artifact"
      ? buildTreeArtifactInstructions(context)
      : kind === "next-step"
        ? buildTreeNextStepInstructions(context)
        : buildTreeOptionsInstructions(context);
  console.info(
    `[treeable:mastra-prompt:${kind}]`,
    JSON.stringify(
      {
        context,
        instructions,
        messages
      },
      null,
      2
    )
  );
}

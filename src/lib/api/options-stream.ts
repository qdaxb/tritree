import { logTritreeAiDebug } from "@/lib/ai/debug-log";
import { streamDirectorOptions } from "@/lib/ai/director-stream";
import { summarizeCurrentArtifactOptionsForDirector } from "@/lib/app-state";
import type { getRepository } from "@/lib/db/repository";
import type { OptionGenerationMode, SessionState } from "@/lib/domain";

type OptionsRepository = Pick<Awaited<ReturnType<typeof getRepository>>, "updateNodeOptions">;

export async function streamOptionsForNode({
  logTarget,
  nodeId,
  optionMode = "balanced",
  repository,
  rootMemoryId,
  send,
  sessionId,
  signal,
  state,
  userId
}: {
  logTarget: "api-options";
  nodeId: string;
  optionMode?: OptionGenerationMode;
  repository: OptionsRepository;
  rootMemoryId: string;
  send: (value: unknown) => void;
  sessionId: string;
  signal?: AbortSignal;
  state: SessionState;
  userId: string;
}) {
  logTritreeAiDebug(logTarget, "options-stream-start", {
    sessionId,
    nodeId,
    optionMode
  });

  const output = await streamDirectorOptions(summarizeCurrentArtifactOptionsForDirector(state, optionMode), {
    signal,
    onReasoningText(event) {
      send({ type: "thinking", nodeId, text: event.accumulatedText });
    },
    onProcessData(data) {
      send({ type: "process_data", nodeId, data });
    },
    onText(event) {
      if (!event.partialOptions) return;
      send({
        type: "options",
        nodeId,
        roundIntent: event.partialRoundIntent,
        options: event.partialOptions
      });
    }
  });

  logTritreeAiDebug(logTarget, "options-stream-output", {
    sessionId,
    nodeId,
    roundIntent: output.roundIntent,
    optionCount: output.options.length,
    optionLabels: output.options.map((option) => option.label)
  });

  const nextState = await repository.updateNodeOptions({
    userId,
    sessionId,
    nodeId,
    output: {
      roundIntent: output.roundIntent,
      options: output.options
    },
    ...(output.agentMessages?.length ? { agentMessages: output.agentMessages } : {})
  });

  send({ type: "options", nodeId, roundIntent: output.roundIntent, options: output.options });
  send({ type: "done", state: nextState });
  return nextState;
}

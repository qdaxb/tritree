export const TOOL_QUERY_MEMORY_MARKER = "# 工具查询记忆";

const TOOL_QUERY_MEMORY_USAGE =
  "后续轮次优先复用这些结果；不要重复相同查询，除非用户要求更新、查询条件改变或已有结果明显不足。";
const MAX_TOOL_QUERY_MEMORY_ENTRY_CHARS = 5000;
const MAX_SESSION_TOOL_MEMORY_CHARS = 16000;

export function createToolQueryMemoryObservation(toolTranscript: string) {
  const transcript = toolTranscript.trim();
  if (!transcript) return "";

  return [
    TOOL_QUERY_MEMORY_MARKER,
    TOOL_QUERY_MEMORY_USAGE,
    truncateText(transcript, MAX_TOOL_QUERY_MEMORY_ENTRY_CHARS)
  ].join("\n");
}

export function appendToolQueryMemoryObservation(memoryObservation: string, toolTranscript: string) {
  const toolMemory = createToolQueryMemoryObservation(toolTranscript);
  if (!toolMemory) return memoryObservation;
  return [memoryObservation.trim(), toolMemory].filter(Boolean).join("\n\n");
}

export function extractToolQueryMemoryObservation(memoryObservation: string) {
  const markerIndex = memoryObservation.indexOf(TOOL_QUERY_MEMORY_MARKER);
  if (markerIndex < 0) return "";
  return truncateText(memoryObservation.slice(markerIndex).trim(), MAX_TOOL_QUERY_MEMORY_ENTRY_CHARS);
}

export function appendSessionToolMemory(existingMemory: string, memoryObservation: string) {
  const entry = extractToolQueryMemoryObservation(memoryObservation);
  if (!entry) return existingMemory.trim();

  const existing = existingMemory.trim();
  if (existing.includes(entry)) return existing;

  return trimSessionToolMemory([existing, entry].filter(Boolean).join("\n\n"));
}

function trimSessionToolMemory(memory: string) {
  if (memory.length <= MAX_SESSION_TOOL_MEMORY_CHARS) return memory;
  return memory.slice(memory.length - MAX_SESSION_TOOL_MEMORY_CHARS).trimStart();
}

function truncateText(text: string, maxLength: number) {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

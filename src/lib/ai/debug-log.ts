const MAX_DEBUG_STRING_LENGTH = 800;
const MAX_DEBUG_ARRAY_ITEMS = 12;
const MAX_DEBUG_OBJECT_KEYS = 24;

export function logTritreeAiDebug(area: string, event: string, details: Record<string, unknown> = {}) {
  if (!isTritreeAiDebugEnabled()) return;
  console.info(`[tritree:${area}:${event}]`, sanitizeDebugValue(details));
}

export function summarizeTritreeStreamEventForLog(value: unknown) {
  if (!isDebugRecord(value)) return { type: typeof value };

  const eventType = typeof value.type === "string" ? value.type : "unknown";
  const summary: Record<string, unknown> = {
    type: eventType,
    nodeId: typeof value.nodeId === "string" ? value.nodeId : null
  };

  if (typeof value.text === "string") {
    summary.textChars = value.text.length;
    summary.textPreview = value.text;
  }

  if (Array.isArray(value.options)) {
    summary.optionCount = value.options.length;
    summary.optionLabels = value.options.flatMap((option) =>
      isDebugRecord(option) && typeof option.label === "string" ? [option.label] : []
    );
  }

  if (isDebugRecord(value.draft)) {
    summary.draftTitle = typeof value.draft.title === "string" ? value.draft.title : "";
    summary.draftBodyChars = typeof value.draft.body === "string" ? value.draft.body.length : 0;
  }

  if (isDebugRecord(value.state)) {
    const currentNode = isDebugRecord(value.state.currentNode) ? value.state.currentNode : null;
    summary.sessionId = isDebugRecord(value.state.session) && typeof value.state.session.id === "string"
      ? value.state.session.id
      : "";
    summary.currentNodeId = currentNode && typeof currentNode.id === "string" ? currentNode.id : "";
    summary.currentNodeOptionCount = currentNode && Array.isArray(currentNode.options) ? currentNode.options.length : 0;
    summary.currentNodeOptionLabels = currentNode && Array.isArray(currentNode.options)
      ? currentNode.options.flatMap((option) =>
          isDebugRecord(option) && typeof option.label === "string" ? [option.label] : []
        )
      : [];
  }

  if (typeof value.error === "string") {
    summary.error = value.error;
  }

  return summary;
}

function isTritreeAiDebugEnabled() {
  if (process.env.TRITREE_DEBUG_STREAM === "1") return true;
  if (process.env.TRITREE_DEBUG_STREAM === "0") return false;
  return process.env.NODE_ENV === "development";
}

function sanitizeDebugValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return truncateDebugString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateDebugString(value.message)
    };
  }

  if (Array.isArray(value)) {
    if (depth >= 3) return `[Array(${value.length})]`;
    const items = value.slice(0, MAX_DEBUG_ARRAY_ITEMS).map((item) => sanitizeDebugValue(item, depth + 1));
    return value.length > MAX_DEBUG_ARRAY_ITEMS ? [...items, `... ${value.length - MAX_DEBUG_ARRAY_ITEMS} more`] : items;
  }

  if (typeof value === "object") {
    if (depth >= 3) return "{...}";
    const entries = Object.entries(value as Record<string, unknown>);
    const visibleEntries = entries.slice(0, MAX_DEBUG_OBJECT_KEYS).map(([key, item]) => [
      key,
      sanitizeDebugValue(item, depth + 1)
    ]);
    const result = Object.fromEntries(visibleEntries);
    if (entries.length > MAX_DEBUG_OBJECT_KEYS) {
      result.__truncatedKeys = entries.length - MAX_DEBUG_OBJECT_KEYS;
    }
    return result;
  }

  return String(value);
}

function truncateDebugString(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_DEBUG_STRING_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_DEBUG_STRING_LENGTH - 3)}...`;
}

function isDebugRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

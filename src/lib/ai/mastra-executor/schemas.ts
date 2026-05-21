import { z } from "zod";

const ProcessDataDisplayItemSchema = z.preprocess(
  normalizeProcessDataDisplayItem,
  z.object({
    title: z.string().trim().min(1).max(160),
    subtitle: z.string().trim().max(400).optional(),
    meta: z.string().trim().max(160).optional(),
    url: z.string().trim().max(1000).optional(),
    urls: z.array(z.string().trim().min(1).max(1000)).max(10).optional()
  })
    .strict()
);

export const ShowProcessDataInputSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    sourceToolCallIds: z.array(z.string().trim().min(1)).max(20).default([]),
    items: z.array(ProcessDataDisplayItemSchema).min(1).max(30),
    note: z.string().trim().max(500).optional()
  })
  .strict();

export type ProcessDataDisplay = z.infer<typeof ShowProcessDataInputSchema>;

function normalizeProcessDataDisplayItem(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  const {
    source_url: _sourceUrlSnake,
    source_urls: _sourceUrlsSnake,
    sourceUrl: _sourceUrlCamel,
    sourceUrls: _sourceUrlsCamel,
    ...rest
  } = record;
  const url = typeof record.url === "string" && record.url.trim()
    ? record.url.trim()
    : typeof record.source_url === "string" && record.source_url.trim()
      ? record.source_url.trim()
      : typeof record.sourceUrl === "string" && record.sourceUrl.trim()
        ? record.sourceUrl.trim()
        : undefined;
  const urls = stringArrayField(record, "urls")
    ?? stringArrayField(record, "source_urls")
    ?? stringArrayField(record, "sourceUrls")
    ?? (url ? [url] : []);
  const normalizedUrl = urls[0] ?? url;

  return {
    ...rest,
    ...(normalizedUrl ? { url: normalizedUrl } : {}),
    ...(urls.length > 0 ? { urls } : {})
  };
}

function stringArrayField(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (!Array.isArray(value)) return undefined;

  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return strings.length > 0 ? strings : undefined;
}

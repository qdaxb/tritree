import { describe, expect, it } from "vitest";
import { ShowProcessDataInputSchema } from "./schemas";

describe("mastra executor schemas", () => {
  it("normalizes source URL aliases into process material item urls", () => {
    const parsed = ShowProcessDataInputSchema.parse({
      title: "参考材料",
      sourceToolCallIds: ["tool-1"],
      items: [
        { title: "参考条目 A", source_url: "https://example.com/a" },
        { title: "参考条目 B", sourceUrl: "https://example.com/b" },
        { title: "参考条目 C", url: "https://example.com/c", source_url: "https://example.com/ignored" }
      ]
    });

    expect(parsed.items.map((item) => item.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c"
    ]);
  });

  it("normalizes multiple process material source URLs", () => {
    const parsed = ShowProcessDataInputSchema.parse({
      title: "参考材料",
      sourceToolCallIds: ["tool-1"],
      items: [
        { title: "参考条目 A", urls: [" https://example.com/a ", "", "https://example.com/b"] },
        { title: "参考条目 B", source_urls: ["https://example.com/c"] },
        { title: "参考条目 C", sourceUrls: ["https://example.com/d", "https://example.com/e"] },
        { title: "参考条目 D", url: "https://example.com/f" }
      ]
    });

    expect(parsed.items).toEqual([
      { title: "参考条目 A", url: "https://example.com/a", urls: ["https://example.com/a", "https://example.com/b"] },
      { title: "参考条目 B", url: "https://example.com/c", urls: ["https://example.com/c"] },
      { title: "参考条目 C", url: "https://example.com/d", urls: ["https://example.com/d", "https://example.com/e"] },
      { title: "参考条目 D", url: "https://example.com/f", urls: ["https://example.com/f"] }
    ]);
  });
});

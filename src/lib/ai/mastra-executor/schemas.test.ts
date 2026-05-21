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
});

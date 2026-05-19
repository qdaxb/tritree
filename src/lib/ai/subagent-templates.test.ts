import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBAGENT_TEMPLATES,
  formatSubagentTemplateSummaries,
  getSubagentTemplate
} from "./subagent-templates";

describe("subagent templates", () => {
  it("only exposes material search as the predefined template", () => {
    expect(DEFAULT_SUBAGENT_TEMPLATES.map((template) => template.id)).toEqual(["material-search"]);
  });

  it("looks up material search by id", () => {
    expect(getSubagentTemplate("material-search")?.title).toBe("搜索资料");
  });

  it("does not expose removed content-work templates", () => {
    expect(getSubagentTemplate("material-organizer")).toBeUndefined();
    expect(getSubagentTemplate("independent-review")).toBeUndefined();
    expect(getSubagentTemplate("title-variants")).toBeUndefined();
    expect(getSubagentTemplate("platform-rewrite")).toBeUndefined();
  });

  it("formats summaries without undefined values", () => {
    const summary = formatSubagentTemplateSummaries();

    expect(summary).toContain("material-search");
    expect(summary).toContain("搜索资料");
    expect(summary).toContain("Expected output:");
    expect(summary).not.toContain("platform-rewrite");
    expect(summary).not.toContain("undefined");
  });

  it("keeps template instruction text in English while preserving the Chinese display title", () => {
    const template = DEFAULT_SUBAGENT_TEMPLATES[0];

    expect(template.title).toBe("搜索资料");
    expect([template.description, template.expectedOutput, template.prompt].join("\n")).not.toMatch(/\p{Script=Han}/u);
    expect(template.prompt).toContain("You are the material-search subagent");
    expect(template.prompt).toContain("Leave decisions about whether to continue");
  });
});

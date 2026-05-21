import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULTS_CONFIG_PATH_ENV,
  defaultDefaultsConfigPath,
  loadConfiguredDefaults,
  resolveDefaultsConfigPath
} from "./defaults";

const exampleDefaultsConfigPath = path.resolve("config/defaults.example.json");
const defaultSystemSkillIds = [
  "system-creator",
  "system-planner",
  "system-researcher",
  "system-writer",
  "system-reviewer",
  "system-publisher"
];
const defaultLoadedSystemSkillIds = ["system-creator", "system-planner"];
const defaultCreationRequestLabels = ["搜资料", "找选题", "文案润色", "审稿及校对", "压缩到300字左右"];
const creatorChildSkillIds = [
  "system-planner",
  "system-researcher",
  "system-writer",
  "system-reviewer",
  "system-publisher"
];
const roleSectionPhrases = ["Role:", "Useful output", "Minimum context before use"];
const protocolPhrases = ["roundIntent", "options[]", "decisionRationale"];

const validConfig = JSON.stringify({
  systemSkills: [
    {
      id: "system-writer",
      title: "系统写作者",
      category: "风格",
      description: "负责生成草稿。",
      prompt: "写出下一版草稿。",
      appliesTo: "writer",
      defaultEnabled: true,
      isArchived: false
    }
  ],
  creationRequestOptions: [
    { id: "default-search-materials", label: "  搜资料  " },
    { id: "default-copy-polish", label: "文案润色", sortOrder: 1 }
  ],
  inspirations: [
    {
      id: "idea-1",
      title: "  AI 产品真实困境  ",
      detail: "  写 AI 产品经理的真实困境。  ",
      artifactTypeIds: ["social-post"]
    }
  ]
});

describe("defaults config loader", () => {
  it("resolves the default config path under .tritree", () => {
    expect(defaultDefaultsConfigPath("/workspace/tritree")).toBe(
      path.join("/workspace/tritree", ".tritree", "defaults.json")
    );
    expect(resolveDefaultsConfigPath({ cwd: "/workspace/tritree", env: {} })).toBe(
      path.join("/workspace/tritree", ".tritree", "defaults.json")
    );
  });

  it("uses an absolute TRITREE_DEFAULTS_CONFIG_PATH override", () => {
    expect(
      resolveDefaultsConfigPath({
        cwd: "/workspace/tritree",
        env: { [DEFAULTS_CONFIG_PATH_ENV]: "/secure/defaults.json" }
      })
    ).toBe("/secure/defaults.json");
  });

  it("rejects relative TRITREE_DEFAULTS_CONFIG_PATH values", () => {
    expect(() =>
      resolveDefaultsConfigPath({
        cwd: "/workspace/tritree",
        env: { [DEFAULTS_CONFIG_PATH_ENV]: "config/defaults.json" }
      })
    ).toThrow("TRITREE_DEFAULTS_CONFIG_PATH must be an absolute path");
  });

  it("rejects a missing config file", () => {
    expect(() =>
      loadConfiguredDefaults({
        configPath: "/workspace/tritree/.tritree/defaults.json",
        exists: () => false
      })
    ).toThrow("Defaults config /workspace/tritree/.tritree/defaults.json was not found");
  });

  it("rejects invalid JSON", () => {
    expect(() =>
      loadConfiguredDefaults({
        configPath: "/workspace/tritree/.tritree/defaults.json",
        exists: () => true,
        readFile: () => "{ invalid json"
      })
    ).toThrow("is not valid JSON");
  });

  it("requires system skills, creation request options, and inspirations fields", () => {
    expect(() =>
      loadConfiguredDefaults({
        configPath: "/workspace/tritree/.tritree/defaults.json",
        exists: () => true,
        readFile: () => JSON.stringify({})
      })
    ).toThrow("systemSkills");

    expect(() =>
      loadConfiguredDefaults({
        configPath: "/workspace/tritree/.tritree/defaults.json",
        exists: () => true,
        readFile: () => JSON.stringify({ systemSkills: [], creationRequestOptions: [], inspirations: [] })
      })
    ).toThrow("systemSkills must be a non-empty array");
  });

  it("rejects duplicate ids within each defaults section", () => {
    const duplicateSkill = () =>
      loadConfiguredDefaults({
        configPath: "/workspace/tritree/.tritree/defaults.json",
        exists: () => true,
        readFile: () =>
          JSON.stringify({
            systemSkills: [
              {
                id: "system-writer",
                title: "系统写作者",
                category: "风格",
                description: "",
                prompt: "写作。",
                appliesTo: "writer"
              },
              {
                id: "system-writer",
                title: "重复写作者",
                category: "风格",
                description: "",
                prompt: "写作。",
                appliesTo: "writer"
              }
            ],
            creationRequestOptions: [],
            inspirations: []
          })
      });

    expect(duplicateSkill).toThrow("Duplicate systemSkills id: system-writer");

    const duplicateRequest = () =>
      loadConfiguredDefaults({
        configPath: "/workspace/tritree/.tritree/defaults.json",
        exists: () => true,
        readFile: () =>
          JSON.stringify({
            systemSkills: [
              {
                id: "system-writer",
                title: "系统写作者",
                category: "风格",
                description: "",
                prompt: "写作。",
                appliesTo: "writer"
              }
            ],
            creationRequestOptions: [
              { id: "default-search-materials", label: "搜资料" },
              { id: "default-search-materials", label: "重复" }
            ],
            inspirations: []
          })
      });

    expect(duplicateRequest).toThrow("Duplicate creationRequestOptions id: default-search-materials");
  });

  it("parses valid defaults through shared schemas", () => {
    const defaults = loadConfiguredDefaults({
      configPath: "/workspace/tritree/.tritree/defaults.json",
      exists: () => true,
      readFile: () => validConfig
    });

    expect(defaults.systemSkills).toEqual([
      expect.objectContaining({
        id: "system-writer",
        appliesTo: "writer",
        defaultEnabled: true,
        isArchived: false
      })
    ]);
    expect(defaults.creationRequestOptions).toEqual([
      { id: "default-search-materials", label: "搜资料" },
      { id: "default-copy-polish", label: "文案润色", sortOrder: 1 }
    ]);
    expect(defaults.inspirations).toEqual([
      {
        id: "idea-1",
        title: "AI 产品真实困境",
        detail: "写 AI 产品经理的真实困境。",
        artifactTypeIds: ["social-post"]
      }
    ]);
  });

  it("keeps the example defaults as role-focused default-enabled system skills", () => {
    const defaults = loadConfiguredDefaults({
      configPath: exampleDefaultsConfigPath,
      exists: () => true,
      readFile: (filePath) => readFileSync(filePath, "utf8")
    });

    const systemSkillsById = new Map(defaults.systemSkills.map((skill) => [skill.id, skill]));

    expect(defaults.systemSkills.map((skill) => skill.id)).toEqual(defaultSystemSkillIds);
    expect(defaults.systemSkills).toHaveLength(defaultSystemSkillIds.length);
    expect(systemSkillsById.get("system-creator")?.title).toBe("创作者");
    expect(systemSkillsById.get("system-planner")?.title).toBe("策划");
    expect(systemSkillsById.get("system-researcher")?.title).toBe("资料员");
    expect(systemSkillsById.get("system-writer")?.title).toBe("写手");
    expect(systemSkillsById.get("system-reviewer")?.title).toBe("审稿");
    expect(systemSkillsById.get("system-publisher")?.title).toBe("发布编辑");
    expect(systemSkillsById.get("system-creator")?.defaultLoaded).toBe(true);
    expect(systemSkillsById.get("system-creator")?.parentSkillId).toBeNull();
    expect(defaults.systemSkills.filter((skill) => skill.defaultLoaded).map((skill) => skill.id)).toEqual(
      defaultLoadedSystemSkillIds
    );
    for (const skillId of creatorChildSkillIds.filter((id) => !defaultLoadedSystemSkillIds.includes(id))) {
      expect(systemSkillsById.get(skillId)?.parentSkillId).toBe("system-creator");
      expect(systemSkillsById.get(skillId)?.defaultLoaded).toBe(false);
    }
    expect(systemSkillsById.get("system-planner")?.parentSkillId).toBe("system-creator");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("Workflow overview");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("planning, research, drafting, review, or publishing closure");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("use Planner when direction is unclear");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("use Researcher when facts, examples, or sources are needed");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("use Writer when body text, drafting, or rewriting is needed");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("use Reviewer when quality judgment is needed");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("use Publisher when the work is close to delivery");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("call load_skill first");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("load_skill(system-writer)");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("Do not simulate child Skills from overview text");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("user-facing output must land in this turn's target artifact or options");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("When the current task intent is a concrete task label");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("Do not advance it to drafting, publishing, or expression-angle selection");
    expect(systemSkillsById.get("system-creator")?.prompt).toContain("If the task intent is research/source-gathering");
    expect(systemSkillsById.get("system-planner")?.prompt).toContain("content can move back and forth among planning, research, writing, review, and publishing");
    expect(systemSkillsById.get("system-planner")?.prompt).toContain("After a draft exists, the work can still return to research");
    expect(systemSkillsById.get("system-planner")?.prompt).toContain("Concrete task labels override generic planning");
    expect(systemSkillsById.get("system-planner")?.prompt).toContain("do not convert a research task into reader, angle, story, or title choices");
    expect(systemSkillsById.get("system-researcher")?.prompt).toContain("material-search");
    expect(systemSkillsById.get("system-researcher")?.prompt).toContain("material, references, examples, evidence, fact checking, or sources");
    expect(systemSkillsById.get("system-researcher")?.prompt).toContain("proactively use available search, retrieval, MCP, or research capabilities");
    expect(systemSkillsById.get("system-researcher")?.prompt).toContain("Cross-check important facts");
    expect(systemSkillsById.get("system-researcher")?.prompt).toContain("Do not fabricate sources, numbers, quotes, people, or timelines");
    expect(systemSkillsById.get("system-researcher")?.prompt).toContain("mark it as open");
    expect(systemSkillsById.get("system-researcher")?.prompt).toContain("turn key material into a user-facing summary");
      expect(systemSkillsById.get("system-researcher")?.prompt).toContain("When show_process_data is available");
      expect(systemSkillsById.get("system-researcher")?.prompt).toContain("items[].title");
      expect(systemSkillsById.get("system-researcher")?.prompt).toContain("items[].url or items[].urls");
      expect(systemSkillsById.get("system-researcher")?.prompt).toContain("multiple source URLs");
      expect(systemSkillsById.get("system-researcher")?.prompt).toContain("sourceToolCallIds");
      expect(systemSkillsById.get("system-researcher")?.prompt).toContain(
        "Every source-backed process item must include clickable source URLs in items[].url or items[].urls"
      );
    expect(systemSkillsById.get("system-researcher")?.prompt).toContain("meta is not a citation substitute");
    expect(systemSkillsById.get("system-researcher")?.prompt).toContain(
      "Do not count or label a process item as sourced when it has no URL"
    );
    expect(systemSkillsById.get("system-writer")?.prompt).toContain("If the artifact type needs title, topics, or image prompt");
    expect(systemSkillsById.get("system-publisher")?.prompt).not.toContain("platform-rewrite");
    for (const skill of defaults.systemSkills) {
      expect(skill.prompt).not.toContain("适合委托");
      expect(skill.prompt).not.toMatch(/\p{Script=Han}/u);
      expect(skill.description).not.toMatch(/\p{Script=Han}/u);
    }
    expect(defaults.systemSkills.filter((skill) => skill.defaultEnabled).map((skill) => skill.id)).toEqual(defaultSystemSkillIds);
    expect(defaults.systemSkills.map((skill) => skill.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(defaults.creationRequestOptions.map((option) => option.label)).toEqual(defaultCreationRequestLabels);

    for (const skillId of defaultSystemSkillIds) {
      const skill = systemSkillsById.get(skillId);
      expect(skill).toEqual(expect.objectContaining({
        category: "content-team",
        appliesTo: "both",
        defaultEnabled: true,
        isArchived: false
      }));
      for (const phrase of roleSectionPhrases) {
        expect(skill?.prompt).toContain(phrase);
      }
      expect(skill?.prompt).toMatch(/Use (for|when):/);
      for (const phrase of protocolPhrases) {
        expect(skill?.prompt).not.toContain(phrase);
      }
    }
  });
});

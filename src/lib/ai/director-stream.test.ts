import { describe, expect, it, vi } from "vitest";
import {
  extractActiveDirectorDraftField,
  extractPartialDirectorOptions,
  extractPartialDirectorDraft,
  parseAnthropicSseTextDeltas,
  streamDirectorDraft,
  streamDirectorOptions
} from "./director-stream";

const directorInput = {
  rootSummary: "Seed：写一个产品故事",
  learnedSummary: "",
  currentDraft: "标题：旧\n正文：旧正文",
  pathSummary: "",
  foldedSummary: "",
  selectedOptionLabel: "扩写",
  enabledSkills: []
};

describe("parseAnthropicSseTextDeltas", () => {
  it("extracts text_delta chunks and ignores non-text events", () => {
    const chunks = parseAnthropicSseTextDeltas(
      [
        "event: message_start",
        'data: {"type":"message_start","message":{"id":"m1"}}',
        "",
        "event: content_block_delta",
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"draft\\":"}}',
        "",
        "event: ping",
        'data: {"type":"ping"}',
        "",
        "event: content_block_delta",
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"body\\":\\"新\\"}"}}',
        ""
      ].join("\n")
    );

    expect(chunks).toEqual(['{"draft":', '{"body":"新"}']);
  });
});

describe("extractPartialDirectorDraft", () => {
  it("returns null when the draft object has no visible fields yet", () => {
    expect(extractPartialDirectorDraft('{"roundIntent":"扩写","draft":{')).toBeNull();
  });

  it("returns a best-effort draft from incomplete accumulated JSON", () => {
    expect(
      extractPartialDirectorDraft(
        '{"roundIntent":"扩写","draft":{"title":"新标题","body":"第一段正在生成","hashtags":["#AI"],"imagePrompt":"'
      )
    ).toEqual({
      title: "新标题",
      body: "第一段正在生成",
      hashtags: ["#AI"],
      imagePrompt: ""
    });
  });

  it("extracts visible hashtags from an incomplete hashtag array", () => {
    expect(
      extractPartialDirectorDraft(
        '{"roundIntent":"扩写","draft":{"title":"新标题","body":"正文","hashtags":["#AI","#写作"'
      )
    ).toEqual({
      title: "新标题",
      body: "正文",
      hashtags: ["#AI", "#写作"],
      imagePrompt: ""
    });
  });
});

describe("extractActiveDirectorDraftField", () => {
  it("reports the body field while body text is streaming", () => {
    expect(extractActiveDirectorDraftField('{"roundIntent":"扩写","draft":{"title":"新标题","body":"第一段')).toBe("body");
  });

  it("reports the image prompt field as soon as that key starts", () => {
    expect(
      extractActiveDirectorDraftField(
        '{"roundIntent":"扩写","draft":{"title":"新标题","body":"正文","hashtags":["#AI"],"imagePrompt":"'
      )
    ).toBe("imagePrompt");
  });
});

describe("extractPartialDirectorOptions", () => {
  it("returns only the option slots whose ids have streamed in", () => {
    expect(
      extractPartialDirectorOptions(
        '{"roundIntent":"下一步","options":[{"id":"a","label":"补真实场景","description":"加入一个办公室场景"},{"'
      )
    ).toEqual([
      {
        id: "a",
        label: "补真实场景",
        description: "加入一个办公室场景",
        impact: "正在生成影响说明",
        kind: "explore"
      }
    ]);

    expect(
      extractPartialDirectorOptions(
        '{"roundIntent":"下一步","options":[{"id":"a","label":"补真实场景","description":"加入一个办公室场景"},{"id":"b","label":"深挖原因"},{"'
      )
    ).toEqual([
      {
        id: "a",
        label: "补真实场景",
        description: "加入一个办公室场景",
        impact: "正在生成影响说明",
        kind: "explore"
      },
      {
        id: "b",
        label: "深挖原因",
        description: "正在生成方向说明",
        impact: "正在生成影响说明",
        kind: "deepen"
      }
    ]);

    expect(
      extractPartialDirectorOptions(
        '{"roundIntent":"下一步","options":[{"id":"a","label":"补真实场景","description":"加入一个办公室场景"},{"id":"b","label":"深挖原因"},{"id":"c"'
      )
    ).toEqual([
      {
        id: "a",
        label: "补真实场景",
        description: "加入一个办公室场景",
        impact: "正在生成影响说明",
        kind: "explore"
      },
      {
        id: "b",
        label: "深挖原因",
        description: "正在生成方向说明",
        impact: "正在生成影响说明",
        kind: "deepen"
      }
    ]);

    expect(
      extractPartialDirectorOptions(
        '{"roundIntent":"下一步","options":[{"id":"a","label":"补真实场景","description":"加入一个办公室场景"},{"id":"b","label":"深挖原因"},{"id":"c","label":"换角度"'
      )
    ).toEqual([
      {
        id: "a",
        label: "补真实场景",
        description: "加入一个办公室场景",
        impact: "正在生成影响说明",
        kind: "explore"
      },
      {
        id: "b",
        label: "深挖原因",
        description: "正在生成方向说明",
        impact: "正在生成影响说明",
        kind: "deepen"
      },
      {
        id: "c",
        label: "换角度",
        description: "正在生成方向说明",
        impact: "正在生成影响说明",
        kind: "reframe"
      }
    ]);
  });
});

describe("streamDirectorDraft", () => {
  it("calls onText with accumulated text and returns the final parsed draft", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                "event: content_block_delta",
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"roundIntent\\":\\"扩写\\",\\"draft\\":{\\"title\\":\\"新标题\\",\\"body\\":\\"新正文\\",\\"hashtags\\":[\\"#AI\\"],\\"imagePrompt\\":\\"新图\\"},\\"memoryObservation\\":\\"观察\\",\\"finishAvailable\\":false,\\"publishPackage\\":null}"}}',
                "",
                "event: message_stop",
                'data: {"type":"message_stop"}',
                ""
              ].join("\n")
            )
          );
          controller.close();
        }
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
    const fetchMock = vi.fn().mockResolvedValue(response);
    const onText = vi.fn();

    const output = await streamDirectorDraft(directorInput, {
      env: { ANTHROPIC_AUTH_TOKEN: "token" },
      fetcher: fetchMock,
      onText
    });

    expect(onText).toHaveBeenCalledWith(expect.objectContaining({ accumulatedText: expect.stringContaining("新正文") }));
    expect(output.draft.body).toBe("新正文");
  });

  it("logs the director prompt before sending the draft request", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                "event: content_block_delta",
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"roundIntent\\":\\"扩写\\",\\"draft\\":{\\"title\\":\\"新标题\\",\\"body\\":\\"新正文\\",\\"hashtags\\":[],\\"imagePrompt\\":\\"\\"},\\"memoryObservation\\":\\"观察\\",\\"finishAvailable\\":false,\\"publishPackage\\":null}"}}',
                "",
                "event: message_stop",
                'data: {"type":"message_stop"}',
                ""
              ].join("\n")
            )
          );
          controller.close();
        }
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
    const fetchMock = vi.fn().mockResolvedValue(response);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      await streamDirectorDraft(directorInput, {
        env: { ANTHROPIC_AUTH_TOKEN: "token" },
        fetcher: fetchMock
      });

      expect(infoSpy).toHaveBeenCalledWith(
        "[treeable:director-prompt:draft]",
        expect.stringContaining('"system"')
      );
      expect(infoSpy).toHaveBeenCalledWith(
        "[treeable:director-prompt:draft]",
        expect.stringContaining('"messages"')
      );
      expect(infoSpy.mock.calls.map((call) => call.join("\n")).join("\n")).not.toContain("token");
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe("streamDirectorOptions", () => {
  it("calls onText with partial options and returns the final parsed options", async () => {
    const encoder = new TextEncoder();
    const finalText = JSON.stringify({
      roundIntent: "下一步",
      options: [
        { id: "a", label: "补场景", description: "A", impact: "A", kind: "explore" },
        { id: "b", label: "深挖", description: "B", impact: "B", kind: "deepen" },
        { id: "c", label: "换角度", description: "C", impact: "C", kind: "reframe" }
      ],
      memoryObservation: "偏好具体表达。"
    });
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                "event: content_block_delta",
                `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: finalText } })}`,
                "",
                "event: message_stop",
                'data: {"type":"message_stop"}',
                ""
              ].join("\n")
            )
          );
          controller.close();
        }
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
    const fetchMock = vi.fn().mockResolvedValue(response);
    const onText = vi.fn();

    const output = await streamDirectorOptions(directorInput, {
      env: { ANTHROPIC_AUTH_TOKEN: "token" },
      fetcher: fetchMock,
      onText
    });

    expect(onText).toHaveBeenCalledWith(expect.objectContaining({ partialOptions: expect.any(Array) }));
    expect(output.options.map((option) => option.label)).toEqual(["补场景", "深挖", "换角度"]);
  });
});

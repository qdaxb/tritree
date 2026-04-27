import { describe, expect, it } from "vitest";
import { createNdjsonParser, encodeNdjson } from "./ndjson";

describe("encodeNdjson", () => {
  it("serializes one JSON object per line", () => {
    expect(encodeNdjson({ type: "draft", draft: { title: "T" } })).toBe('{"type":"draft","draft":{"title":"T"}}\n');
  });
});

describe("createNdjsonParser", () => {
  it("parses complete and split lines without dropping buffered text", () => {
    const values: unknown[] = [];
    const parser = createNdjsonParser((value) => values.push(value));

    parser.push('{"type":"draft","draft":{"body":"一');
    parser.push('段"}}\n{"type":"done","state":{"session":{"id":"s1"}}}\n');
    parser.flush();

    expect(values).toEqual([
      { type: "draft", draft: { body: "一段" } },
      { type: "done", state: { session: { id: "s1" } } }
    ]);
  });

  it("throws a clear error when the final buffered line is invalid JSON", () => {
    const parser = createNdjsonParser(() => {});
    parser.push('{"type":"draft"');

    expect(() => parser.flush()).toThrow("Invalid NDJSON stream event.");
  });
});

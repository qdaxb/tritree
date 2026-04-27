export function encodeNdjson(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}

export function createNdjsonParser(onValue: (value: unknown) => void) {
  let buffer = "";

  function parseLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      onValue(JSON.parse(trimmed) as unknown);
    } catch (error) {
      throw new Error("Invalid NDJSON stream event.", { cause: error });
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        parseLine(line);
      }
    },
    flush() {
      parseLine(buffer);
      buffer = "";
    }
  };
}

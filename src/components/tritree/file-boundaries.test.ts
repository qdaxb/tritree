import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Tritree component file boundaries", () => {
  it("keeps the app shell in a focused TritreeApp file", () => {
    const appFile = path.join(process.cwd(), "src/components/TritreeApp.tsx");
    const legacyAppFile = path.join(process.cwd(), "src/components/TreeableApp.tsx");

    expect(existsSync(appFile)).toBe(true);
    expect(existsSync(legacyAppFile)).toBe(false);

    const lines = readFileSync(appFile, "utf8").split("\n").length;
    expect(lines).toBeLessThanOrEqual(1800);
  });
});

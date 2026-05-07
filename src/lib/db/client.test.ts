import { afterEach, describe, expect, it } from "vitest";
import { defaultDbPath } from "./client";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("defaultDbPath", () => {
  it("stores new Tritree data in .tritree by default", () => {
    delete process.env.TRITREE_DB_PATH;
    delete process.env.TREEABLE_DB_PATH;

    expect(defaultDbPath()).toMatch(/\.tritree\/tritree\.sqlite$/);
  });

  it("prefers TRITREE_DB_PATH while keeping TREEABLE_DB_PATH as a legacy fallback", () => {
    process.env.TRITREE_DB_PATH = "/tmp/new-tritree.sqlite";
    process.env.TREEABLE_DB_PATH = "/tmp/old-treeable.sqlite";

    expect(defaultDbPath()).toBe("/tmp/new-tritree.sqlite");

    delete process.env.TRITREE_DB_PATH;
    expect(defaultDbPath()).toBe("/tmp/old-treeable.sqlite");
  });
});

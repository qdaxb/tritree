import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes a password into the Tritree scrypt format", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(hash).not.toContain("correct horse battery staple");
  });

  it("verifies the original password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("rejects malformed password hashes", async () => {
    await expect(verifyPassword("anything", "not-a-valid-hash")).resolves.toBe(false);
  });

  it("rejects hashes with extra trailing fields", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const tamperedHash = `${hash}$extra`;

    await expect(verifyPassword("correct horse battery staple", tamperedHash)).resolves.toBe(false);
  });

  it("rejects hashes with an unexpected derived-key length", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const shortHash = hash.split("$").slice(0, 5).concat("abcd").join("$");

    await expect(verifyPassword("correct horse battery staple", shortHash)).resolves.toBe(false);
  });
});

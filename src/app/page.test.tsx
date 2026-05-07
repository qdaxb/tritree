import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const authMock = vi.hoisted(() => vi.fn());
const getRepositoryMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({
  auth: authMock
}));

vi.mock("@/components/TreeableApp", () => ({
  TreeableApp: vi.fn(() => null)
}));

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock
}));

describe("HomePage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes draft query params to the workspace app", async () => {
    getRepositoryMock.mockReturnValue({
      getUser: vi.fn(() => ({
        id: "user-1",
        username: "awei",
        displayName: "Awei",
        role: "member",
        isActive: true
      })),
      hasUsers: vi.fn(() => true)
    });
    authMock.mockResolvedValue({ user: { id: "user-1" } });

    const element = (await HomePage({
      searchParams: Promise.resolve({
        new: "1",
        sessionId: ["session-1", "ignored-session"]
      })
    })) as ReactElement<{
      currentUser: { id: string; isAdmin: boolean; role: string };
      initialSessionId?: string;
      startNewDraft?: boolean;
    }>;

    expect(element.props.currentUser).toEqual(
      expect.objectContaining({
        id: "user-1",
        isAdmin: false,
        role: "member"
      })
    );
    expect(element.props.initialSessionId).toBe("session-1");
    expect(element.props.startNewDraft).toBe(true);
  });
});

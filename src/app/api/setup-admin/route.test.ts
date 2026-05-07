import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const getRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

const adminUser = {
  id: "user-1",
  username: "awei",
  displayName: "Awei",
  role: "admin",
  isActive: true,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

function setupRequest(body: unknown) {
  return new Request("http://test.local/api/setup-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  getRepositoryMock.mockReset();
});

describe("POST /api/setup-admin", () => {
  it("creates the first administrator when no users exist", async () => {
    const createInitialAdmin = vi.fn().mockResolvedValue(adminUser);
    getRepositoryMock.mockReturnValue({ hasUsers: () => false, createInitialAdmin });

    const response = await POST(
      setupRequest({
        username: "awei",
        displayName: "Awei",
        password: "password-123",
        passwordConfirmation: "password-123"
      })
    );

    expect(response.status).toBe(200);
    expect(createInitialAdmin).toHaveBeenCalledWith({
      username: "awei",
      displayName: "Awei",
      password: "password-123"
    });
    expect(await response.json()).toEqual({
      user: expect.objectContaining({ username: "awei", role: "admin", isActive: true })
    });
  });

  it("rejects setup when a user already exists", async () => {
    const createInitialAdmin = vi.fn();
    getRepositoryMock.mockReturnValue({ hasUsers: () => true, createInitialAdmin });

    const response = await POST(
      setupRequest({
        username: "awei",
        displayName: "Awei",
        password: "password-123",
        passwordConfirmation: "password-123"
      })
    );

    expect(response.status).toBe(409);
    expect(createInitialAdmin).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "管理员已经初始化。" });
  });

  it("rejects mismatched password confirmation", async () => {
    const createInitialAdmin = vi.fn();
    getRepositoryMock.mockReturnValue({ hasUsers: () => false, createInitialAdmin });

    const response = await POST(
      setupRequest({
        username: "awei",
        displayName: "Awei",
        password: "password-123",
        passwordConfirmation: "password-456"
      })
    );

    expect(response.status).toBe(400);
    expect(createInitialAdmin).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error).toBe("请求内容格式不正确。");
    expect(body.issues).toEqual([expect.objectContaining({ path: ["passwordConfirmation"] })]);
  });
});

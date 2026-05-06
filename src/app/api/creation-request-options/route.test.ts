import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError } from "@/lib/auth/current-user";
import { DELETE, PATCH } from "./[optionId]/route";
import { GET, POST, PUT } from "./route";
import { POST as RESET } from "./reset/route";

const getRepositoryMock = vi.hoisted(() => vi.fn());
const requireCurrentUserMock = vi.hoisted(() => vi.fn());

const currentUser = {
  id: "user-1",
  username: "awei",
  displayName: "Awei",
  role: "admin",
  isActive: true,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/current-user", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/current-user")>("@/lib/auth/current-user");
  return {
    ...actual,
    requireCurrentUser: requireCurrentUserMock
  };
});

vi.mock("@/lib/db/repository", () => ({
  getRepository: getRepositoryMock
}));

beforeEach(() => {
  getRepositoryMock.mockReset();
  requireCurrentUserMock.mockReset();
  requireCurrentUserMock.mockResolvedValue(currentUser);
});

describe("/api/creation-request-options", () => {
  it("returns 401 when listing quick request buttons without login", async () => {
    requireCurrentUserMock.mockRejectedValue(new AuthApiError(401, "请先登录。"));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录。" });
  });

  it("lists sqlite-backed quick request buttons", async () => {
    getRepositoryMock.mockReturnValue({
      listCreationRequestOptions: vi.fn().mockReturnValue([{ id: "request-1", label: "保留原意" }])
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.options).toEqual([{ id: "request-1", label: "保留原意" }]);
  });

  it("creates a quick request button", async () => {
    const createCreationRequestOption = vi.fn().mockReturnValue({ id: "request-custom", label: "面向海外游客" });
    getRepositoryMock.mockReturnValue({ createCreationRequestOption });

    const response = await POST(
      new Request("http://test.local/api/creation-request-options", {
        method: "POST",
        body: JSON.stringify({ label: "面向海外游客" })
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createCreationRequestOption).toHaveBeenCalledWith("user-1", { label: "面向海外游客" });
    expect(data.option).toEqual({ id: "request-custom", label: "面向海外游客" });
  });

  it("reorders quick request buttons", async () => {
    const reorderCreationRequestOptions = vi.fn().mockReturnValue([
      { id: "request-b", label: "不要扩写太多" },
      { id: "request-a", label: "保留我的原意" }
    ]);
    getRepositoryMock.mockReturnValue({ reorderCreationRequestOptions });

    const response = await PUT(
      new Request("http://test.local/api/creation-request-options", {
        method: "PUT",
        body: JSON.stringify({ orderedIds: ["request-b", "request-a"] })
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(reorderCreationRequestOptions).toHaveBeenCalledWith("user-1", ["request-b", "request-a"]);
    expect(data.options.map((option: { id: string }) => option.id)).toEqual(["request-b", "request-a"]);
  });

  it("resets quick request buttons to defaults", async () => {
    const resetCreationRequestOptions = vi.fn().mockReturnValue([{ id: "default-preserve-my-meaning", label: "保留我的原意" }]);
    getRepositoryMock.mockReturnValue({ resetCreationRequestOptions });

    const response = await RESET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(resetCreationRequestOptions).toHaveBeenCalledWith("user-1");
    expect(data.options).toEqual([{ id: "default-preserve-my-meaning", label: "保留我的原意" }]);
  });

  it("updates a quick request button", async () => {
    const updateCreationRequestOption = vi.fn().mockReturnValue({ id: "request-custom", label: "写给第一次来的人" });
    getRepositoryMock.mockReturnValue({ updateCreationRequestOption });

    const response = await PATCH(
      new Request("http://test.local/api/creation-request-options/request-custom", {
        method: "PATCH",
        body: JSON.stringify({ label: "写给第一次来的人" })
      }),
      { params: Promise.resolve({ optionId: "request-custom" }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(updateCreationRequestOption).toHaveBeenCalledWith("user-1", "request-custom", { label: "写给第一次来的人" });
    expect(data.option.label).toBe("写给第一次来的人");
  });

  it("deletes a quick request button", async () => {
    const deleteCreationRequestOption = vi.fn();
    getRepositoryMock.mockReturnValue({ deleteCreationRequestOption });

    const response = await DELETE(
      new Request("http://test.local/api/creation-request-options/request-custom", { method: "DELETE" }),
      { params: Promise.resolve({ optionId: "request-custom" }) }
    );

    expect(response.status).toBe(200);
    expect(deleteCreationRequestOption).toHaveBeenCalledWith("user-1", "request-custom");
  });
});

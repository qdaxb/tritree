import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupAdminForm } from "./SetupAdminForm";

const originalLocation = window.location;

function mockLocationAssign() {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign }
  });
  return assign;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation
  });
});

describe("SetupAdminForm", () => {
  it("posts the initial administrator and redirects to login", async () => {
    const assign = mockLocationAssign();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        user: { id: "user-1", username: "awei", displayName: "Awei", role: "admin", isActive: true }
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupAdminForm />);

    await userEvent.type(screen.getByLabelText("用户名"), "awei");
    await userEvent.type(screen.getByLabelText("显示名称"), "Awei");
    await userEvent.type(screen.getByLabelText("密码"), "password-123");
    await userEvent.type(screen.getByLabelText("确认密码"), "password-123");
    await userEvent.click(screen.getByRole("button", { name: "初始化管理员" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/setup-admin",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "awei",
          displayName: "Awei",
          password: "password-123",
          passwordConfirmation: "password-123"
        })
      })
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
  });

  it("validates password confirmation before posting", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SetupAdminForm />);

    await userEvent.type(screen.getByLabelText("用户名"), "awei");
    await userEvent.type(screen.getByLabelText("显示名称"), "Awei");
    await userEvent.type(screen.getByLabelText("密码"), "password-123");
    await userEvent.type(screen.getByLabelText("确认密码"), "password-456");
    await userEvent.click(screen.getByRole("button", { name: "初始化管理员" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("两次输入的密码不一致。");
  });
});

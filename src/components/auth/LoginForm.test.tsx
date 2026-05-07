import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";

const signInMock = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({
  signIn: signInMock
}));

const originalLocation = window.location;

function mockLocationAssign() {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign }
  });
  return assign;
}

beforeEach(() => {
  signInMock.mockReset();
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation
  });
});

describe("LoginForm", () => {
  it("submits username and password credentials and navigates on success", async () => {
    const assign = mockLocationAssign();
    signInMock.mockResolvedValue({ ok: true, url: "/" });
    render(<LoginForm isOidcEnabled={false} />);

    await userEvent.type(screen.getByLabelText("用户名"), "awei");
    await userEvent.type(screen.getByLabelText("密码"), "password-123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(signInMock).toHaveBeenCalledWith("credentials", {
      username: "awei",
      password: "password-123",
      redirect: false,
      callbackUrl: "/"
    });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("keeps successful credentials login on the current origin", async () => {
    const assign = mockLocationAssign();
    signInMock.mockResolvedValue({ ok: true, url: "http://localhost:3000/" });
    render(<LoginForm isOidcEnabled={false} />);

    await userEvent.type(screen.getByLabelText("用户名"), "awei");
    await userEvent.type(screen.getByLabelText("密码"), "password-123");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("displays an invalid credentials error", async () => {
    signInMock.mockResolvedValue({ error: "CredentialsSignin", ok: false, url: null });
    render(<LoginForm isOidcEnabled={false} />);

    await userEvent.type(screen.getByLabelText("用户名"), "awei");
    await userEvent.type(screen.getByLabelText("密码"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("用户名或密码不正确。");
  });

  it("hides the OIDC sign-in button when OIDC is disabled", () => {
    render(<LoginForm isOidcEnabled={false} />);

    expect(screen.queryByRole("button", { name: "使用 OIDC 登录" })).not.toBeInTheDocument();
  });

  it("renders and starts OIDC sign-in when enabled", async () => {
    render(<LoginForm isOidcEnabled={true} />);

    await userEvent.click(screen.getByRole("button", { name: "使用 OIDC 登录" }));

    expect(signInMock).toHaveBeenCalledWith("oidc", { callbackUrl: "/" });
  });
});

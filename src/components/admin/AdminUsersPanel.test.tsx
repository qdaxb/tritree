import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUsersPanel } from "./AdminUsersPanel";

const timestamp = "2026-05-06T00:00:00.000Z";

type TestUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  oidcIdentities: Array<{
    id: string;
    userId: string;
    issuer: string;
    subject: string;
    email: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body
  };
}

function deferredResponse<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("AdminUsersPanel", () => {
  let users: TestUser[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    users = [
      {
        id: "user-1",
        username: "awei",
        displayName: "Awei",
        role: "admin",
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        oidcIdentities: []
      },
      {
        id: "user-2",
        username: "writer",
        displayName: "Writer",
        role: "member",
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        oidcIdentities: [
          {
            id: "identity-1",
            userId: "user-2",
            issuer: "https://issuer.example.com",
            subject: "subject-1",
            email: "writer@example.com",
            name: "Writer OIDC",
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ]
      }
    ];

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/admin/users" && method === "GET") {
        return jsonResponse({ users });
      }

      if (url === "/api/admin/users" && method === "POST") {
        const body = JSON.parse(init?.body as string) as { username: string; displayName: string; role: "admin" | "member" };
        const user: TestUser = {
          id: "user-3",
          username: body.username,
          displayName: body.displayName,
          role: body.role,
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
          oidcIdentities: []
        };
        users = [...users, user];
        return jsonResponse({ user });
      }

      if (url === "/api/admin/users/user-2" && method === "PATCH") {
        const body = JSON.parse(init?.body as string) as Partial<Pick<TestUser, "isActive" | "role">>;
        users = users.map((user) => (user.id === "user-2" ? { ...user, ...body } : user));
        return jsonResponse({ user: users.find((user) => user.id === "user-2") });
      }

      if (url === "/api/admin/users/user-2/reset-password" && method === "POST") {
        return jsonResponse({ user: users.find((user) => user.id === "user-2") });
      }

      if (url === "/api/admin/users/user-2/oidc-identities" && method === "POST") {
        const body = JSON.parse(init?.body as string) as {
          issuer: string;
          subject: string;
          email: string;
          name: string;
        };
        const identity = {
          id: "identity-2",
          userId: "user-2",
          createdAt: timestamp,
          updatedAt: timestamp,
          ...body
        };
        users = users.map((user) =>
          user.id === "user-2" ? { ...user, oidcIdentities: [...user.oidcIdentities, identity] } : user
        );
        return jsonResponse({ identity });
      }

      if (url === "/api/admin/users/user-2/oidc-identities/identity-1" && method === "DELETE") {
        users = users.map((user) =>
          user.id === "user-2"
            ? { ...user, oidcIdentities: user.oidcIdentities.filter((identity) => identity.id !== "identity-1") }
            : user
        );
        return jsonResponse({ ok: true });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("provides a way back to the main workspace", async () => {
    render(<AdminUsersPanel />);

    expect(await screen.findByText("awei")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回创作" })).toHaveAttribute("href", "/");
  });

  it("renders users and performs create, reset, activation, role, OIDC bind, and OIDC unbind actions", async () => {
    render(<AdminUsersPanel />);

    expect(await screen.findByText("awei")).toBeInTheDocument();
    expect(screen.getByText("writer")).toBeInTheDocument();
    expect(screen.getByText("OIDC 绑定 1")).toBeInTheDocument();
    expect(screen.getByText("subject-1")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("用户名"), "reader");
    await userEvent.type(screen.getByLabelText("显示名"), "Reader");
    await userEvent.type(screen.getByLabelText("初始密码"), "password-123");
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/users", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByText("reader")).toBeInTheDocument();

    const writerRow = screen.getByRole("group", { name: "writer" });

    await userEvent.type(within(writerRow).getByLabelText("新密码"), "new-password-123");
    await userEvent.click(within(writerRow).getByRole("button", { name: "重置密码" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/user-2/reset-password",
      expect.objectContaining({ method: "POST" })
    );

    await userEvent.click(within(writerRow).getByRole("button", { name: "停用" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/users/user-2",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ isActive: false }) })
      )
    );
    expect(await within(writerRow).findByRole("button", { name: "启用" })).toBeInTheDocument();

    await userEvent.click(within(writerRow).getByRole("button", { name: "设为管理员" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/users/user-2",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "admin" }) })
      )
    );
    expect(await within(writerRow).findByRole("button", { name: "设为成员" })).toBeInTheDocument();

    await userEvent.clear(within(writerRow).getByLabelText("Issuer"));
    await userEvent.type(within(writerRow).getByLabelText("Issuer"), "https://accounts.example.com");
    await userEvent.clear(within(writerRow).getByLabelText("Subject"));
    await userEvent.type(within(writerRow).getByLabelText("Subject"), "subject-2");
    await userEvent.type(within(writerRow).getByLabelText("Email"), "writer2@example.com");
    await userEvent.type(within(writerRow).getByLabelText("Name"), "Writer Two");
    await userEvent.click(within(writerRow).getByRole("button", { name: "绑定 OIDC" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/user-2/oidc-identities",
      expect.objectContaining({ method: "POST" })
    );
    expect(await within(writerRow).findByText("subject-2")).toBeInTheDocument();

    await userEvent.click(within(writerRow).getAllByRole("button", { name: "解绑 OIDC" })[0]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/user-2/oidc-identities/identity-1",
      expect.objectContaining({ method: "DELETE" })
    );
    await waitFor(() => expect(within(writerRow).queryByText("subject-1")).not.toBeInTheDocument());
  });

  it("disables row mutation buttons while patch and OIDC unbind actions are pending", async () => {
    const patchResponse = deferredResponse<ReturnType<typeof jsonResponse>>();
    const deleteResponse = deferredResponse<ReturnType<typeof jsonResponse>>();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/admin/users" && method === "GET") {
        return jsonResponse({ users });
      }
      if (url === "/api/admin/users/user-2" && method === "PATCH") {
        return patchResponse.promise;
      }
      if (url === "/api/admin/users/user-2/oidc-identities/identity-1" && method === "DELETE") {
        return deleteResponse.promise;
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    render(<AdminUsersPanel />);

    const writerRow = await screen.findByRole("group", { name: "writer" });
    const deactivateButton = within(writerRow).getByRole("button", { name: "停用" });
    const roleButton = within(writerRow).getByRole("button", { name: "设为管理员" });
    const unbindButton = within(writerRow).getByRole("button", { name: "解绑 OIDC" });

    await userEvent.click(deactivateButton);

    await waitFor(() => expect(deactivateButton).toBeDisabled());
    expect(roleButton).toBeDisabled();
    expect(unbindButton).toBeDisabled();

    patchResponse.resolve(jsonResponse({ user: users[1] }));
    await waitFor(() => expect(deactivateButton).not.toBeDisabled());

    await userEvent.click(unbindButton);

    await waitFor(() => expect(unbindButton).toBeDisabled());
    expect(deactivateButton).toBeDisabled();
    expect(roleButton).toBeDisabled();

    deleteResponse.resolve(jsonResponse({ ok: true }));
    await waitFor(() => expect(unbindButton).not.toBeDisabled());
  });
});

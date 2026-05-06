"use client";

import { type FormEvent, useEffect, useState } from "react";

type AdminUserView = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  isActive: boolean;
  oidcIdentities: Array<{
    id: string;
    issuer: string;
    subject: string;
    email: string;
    name: string;
  }>;
};

type CreateUserFormState = {
  username: string;
  displayName: string;
  password: string;
  isAdmin: boolean;
};

type OidcFormState = {
  issuer: string;
  subject: string;
  email: string;
  name: string;
};

const emptyCreateForm: CreateUserFormState = {
  username: "",
  displayName: "",
  password: "",
  isAdmin: false
};

const emptyOidcForm: OidcFormState = {
  issuer: "",
  subject: "",
  email: "",
  name: ""
};

async function readJson(response: Response) {
  try {
    return (await response.json()) as { error?: string; users?: AdminUserView[] };
  } catch {
    return {};
  }
}

export function AdminUsersPanel() {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [createForm, setCreateForm] = useState<CreateUserFormState>(emptyCreateForm);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [oidcForms, setOidcForms] = useState<Record<string, OidcFormState>>({});
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function loadUsers() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/users");
      const data = await readJson(response);
      if (!response.ok) {
        setMessage(data.error ?? "用户管理失败。");
        return;
      }
      setUsers(data.users ?? []);
    } catch {
      setMessage("用户管理失败。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function submitCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setBusyAction("create");

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: createForm.username,
          displayName: createForm.displayName,
          password: createForm.password,
          role: createForm.isAdmin ? "admin" : "member",
          isActive: true
        })
      });
      const data = await readJson(response);
      if (!response.ok) {
        setMessage(data.error ?? "用户管理失败。");
        return;
      }
      setCreateForm(emptyCreateForm);
      await loadUsers();
    } catch {
      setMessage("用户管理失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function patchUser(userId: string, body: Partial<Pick<AdminUserView, "isActive" | "role" | "displayName">>) {
    setMessage("");
    setBusyAction(`${userId}:patch`);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await readJson(response);
      if (!response.ok) {
        setMessage(data.error ?? "用户管理失败。");
        return;
      }
      await loadUsers();
    } catch {
      setMessage("用户管理失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function resetPassword(userId: string) {
    const password = passwords[userId] ?? "";
    setMessage("");
    setBusyAction(`${userId}:reset-password`);
    try {
      const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const data = await readJson(response);
      if (!response.ok) {
        setMessage(data.error ?? "用户管理失败。");
        return;
      }
      setPasswords((current) => ({ ...current, [userId]: "" }));
      await loadUsers();
    } catch {
      setMessage("用户管理失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function bindOidcIdentity(userId: string) {
    const form = oidcForms[userId] ?? emptyOidcForm;
    setMessage("");
    setBusyAction(`${userId}:bind-oidc`);
    try {
      const response = await fetch(`/api/admin/users/${userId}/oidc-identities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await readJson(response);
      if (!response.ok) {
        setMessage(data.error ?? "用户管理失败。");
        return;
      }
      setOidcForms((current) => ({ ...current, [userId]: emptyOidcForm }));
      await loadUsers();
    } catch {
      setMessage("用户管理失败。");
    } finally {
      setBusyAction(null);
    }
  }

  async function unbindOidcIdentity(userId: string, identityId: string) {
    setMessage("");
    setBusyAction(`${userId}:unbind-oidc:${identityId}`);
    try {
      const response = await fetch(`/api/admin/users/${userId}/oidc-identities/${identityId}`, {
        method: "DELETE"
      });
      const data = await readJson(response);
      if (!response.ok) {
        setMessage(data.error ?? "用户管理失败。");
        return;
      }
      await loadUsers();
    } catch {
      setMessage("用户管理失败。");
    } finally {
      setBusyAction(null);
    }
  }

  function oidcFormFor(userId: string) {
    return oidcForms[userId] ?? emptyOidcForm;
  }

  function updateOidcForm(userId: string, patch: Partial<OidcFormState>) {
    setOidcForms((current) => ({
      ...current,
      [userId]: {
        ...emptyOidcForm,
        ...(current[userId] ?? {}),
        ...patch
      }
    }));
  }

  function isRowBusy(userId: string) {
    return busyAction?.startsWith(`${userId}:`) ?? false;
  }

  return (
    <main className="admin-page">
      <section className="admin-panel" aria-labelledby="admin-users-title">
        <div className="admin-panel__header">
          <h1 id="admin-users-title">用户管理</h1>
          <span>{isLoading ? "加载中" : `${users.length} 个用户`}</span>
        </div>

        {message ? (
          <p className="admin-alert" role="alert">
            {message}
          </p>
        ) : null}

        <form className="admin-create-form" onSubmit={submitCreateUser}>
          <label>
            <span>用户名</span>
            <input
              autoComplete="off"
              required
              value={createForm.username}
              onChange={(event) => setCreateForm((current) => ({ ...current, username: event.target.value }))}
            />
          </label>
          <label>
            <span>显示名</span>
            <input
              autoComplete="off"
              required
              value={createForm.displayName}
              onChange={(event) => setCreateForm((current) => ({ ...current, displayName: event.target.value }))}
            />
          </label>
          <label>
            <span>初始密码</span>
            <input
              autoComplete="new-password"
              minLength={8}
              required
              type="password"
              value={createForm.password}
              onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>
          <label className="admin-checkbox">
            <input
              checked={createForm.isAdmin}
              type="checkbox"
              onChange={(event) => setCreateForm((current) => ({ ...current, isAdmin: event.target.checked }))}
            />
            <span>管理员</span>
          </label>
          <button className="admin-primary-button" disabled={busyAction === "create"} type="submit">
            创建用户
          </button>
        </form>

        <div className="admin-user-list">
          {users.map((user) => {
            const form = oidcFormFor(user.id);
            const rowBusy = isRowBusy(user.id);
            return (
              <section className="admin-user-row" aria-label={user.username} key={user.id} role="group">
                <div className="admin-user-main">
                  <div>
                    <h2>{user.username}</h2>
                    <p>{user.displayName}</p>
                  </div>
                  <div className="admin-user-meta">
                    <span>{user.role === "admin" ? "管理员" : "成员"}</span>
                    <span>{user.isActive ? "启用" : "停用"}</span>
                    <span>OIDC 绑定 {user.oidcIdentities.length}</span>
                  </div>
                </div>

                <div className="admin-actions">
                  <button
                    disabled={rowBusy}
                    type="button"
                    onClick={() => void patchUser(user.id, { isActive: !user.isActive })}
                  >
                    {user.isActive ? "停用" : "启用"}
                  </button>
                  <button
                    disabled={rowBusy}
                    type="button"
                    onClick={() => void patchUser(user.id, { role: user.role === "admin" ? "member" : "admin" })}
                  >
                    {user.role === "admin" ? "设为成员" : "设为管理员"}
                  </button>
                </div>

                <div className="admin-password-actions">
                  <label>
                    <span>新密码</span>
                    <input
                      autoComplete="new-password"
                      minLength={8}
                      type="password"
                      value={passwords[user.id] ?? ""}
                      onChange={(event) => setPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                    />
                  </label>
                  <button
                    disabled={rowBusy}
                    type="button"
                    onClick={() => void resetPassword(user.id)}
                  >
                    重置密码
                  </button>
                </div>

                <div className="admin-oidc-list">
                  {user.oidcIdentities.length ? (
                    user.oidcIdentities.map((identity) => (
                      <div className="admin-oidc-item" key={identity.id}>
                        <div>
                          <strong>{identity.issuer}</strong>
                          <span>{identity.subject}</span>
                          {identity.email ? <span>{identity.email}</span> : null}
                          {identity.name ? <span>{identity.name}</span> : null}
                        </div>
                        <button disabled={rowBusy} type="button" onClick={() => void unbindOidcIdentity(user.id, identity.id)}>
                          解绑 OIDC
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="admin-empty">无 OIDC 绑定</p>
                  )}
                </div>

                <div className="admin-oidc-form">
                  <label>
                    <span>Issuer</span>
                    <input
                      value={form.issuer}
                      onChange={(event) => updateOidcForm(user.id, { issuer: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Subject</span>
                    <input
                      value={form.subject}
                      onChange={(event) => updateOidcForm(user.id, { subject: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => updateOidcForm(user.id, { email: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Name</span>
                    <input
                      value={form.name}
                      onChange={(event) => updateOidcForm(user.id, { name: event.target.value })}
                    />
                  </label>
                  <button
                    disabled={rowBusy}
                    type="button"
                    onClick={() => void bindOidcIdentity(user.id)}
                  >
                    绑定 OIDC
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}

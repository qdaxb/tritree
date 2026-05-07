"use client";

import { type FormEvent, useState } from "react";

export function SetupAdminForm() {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (password !== passwordConfirmation) {
      setMessage("两次输入的密码不一致。");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/setup-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, displayName, password, passwordConfirmation })
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setMessage(data.error ?? "无法初始化管理员。");
        return;
      }

      window.location.assign("/login");
    } catch {
      setMessage("无法初始化管理员，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-panel" onSubmit={submit}>
        <p className="eyebrow">Tritree</p>
        <h1>初始化管理员</h1>
        <p className="auth-copy">创建第一个本地管理员账号。</p>
        {message ? (
          <p className="auth-message" role="alert">
            {message}
          </p>
        ) : null}
        <label>
          <span>用户名</span>
          <input
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          <span>显示名称</span>
          <input
            autoComplete="name"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          <span>密码</span>
          <input
            autoComplete="new-password"
            minLength={8}
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          <span>确认密码</span>
          <input
            autoComplete="new-password"
            minLength={8}
            required
            type="password"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
          />
        </label>
        <button className="primary-action" disabled={isSubmitting} type="submit">
          {isSubmitting ? "初始化中" : "初始化管理员"}
        </button>
      </form>
    </main>
  );
}

"use client";

import { type FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

type LoginFormProps = {
  isOidcEnabled: boolean;
};

export function LoginForm({ isOidcEnabled }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");

    try {
      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
        callbackUrl: "/"
      });

      if (result?.error || result?.ok === false) {
        setMessage("用户名或密码不正确。");
        return;
      }

      window.location.assign(result?.url ?? "/");
    } catch {
      setMessage("登录失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-panel" onSubmit={submit}>
        <p className="eyebrow">Tritree</p>
        <h1>登录</h1>
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
          <span>密码</span>
          <input
            autoComplete="current-password"
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="primary-action" disabled={isSubmitting} type="submit">
          {isSubmitting ? "登录中" : "登录"}
        </button>
        {isOidcEnabled ? (
          <button className="secondary-button" onClick={() => void signIn("oidc", { callbackUrl: "/" })} type="button">
            使用 OIDC 登录
          </button>
        ) : null}
      </form>
    </main>
  );
}

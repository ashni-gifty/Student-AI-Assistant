import { useState } from "react";
import { api } from "../api";

export default function Auth({ onLogin }) {
  const [view, setView] = useState("login"); // login | register | forgot | reset
  const [f, setF] = useState({ username: "", password: "", email: "", code: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = (v) => { setView(v); setMsg(""); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      if (view === "login" || view === "register") {
        onLogin(await api(`/auth/${view}/`, { method: "POST", body: f }));
      } else if (view === "forgot") {
        await api("/auth/forgot/", { method: "POST", body: f });
        go("reset"); setMsg("If that name exists, a 6-digit code was sent to its email.");
      } else {
        await api("/auth/reset/", { method: "POST", body: f });
        go("login"); setMsg("Password changed. Log in with your new password.");
      }
    } catch (er) { setMsg(er.message); }
    setBusy(false);
  };

  const titles = { login: "Log in", register: "Create account", forgot: "Reset your password", reset: "Enter your code" };
  return (
    <div className="auth">
      <form onSubmit={submit}>
        <h1>Student AI Assistant</h1>
        <p className="muted">{titles[view]}</p>
        <label>Student name<input value={f.username} onChange={set("username")} autoComplete="username" required /></label>
        {view === "register" && <label>Email<input type="email" value={f.email} onChange={set("email")} required /></label>}
        {view === "reset" && <label>6-digit code<input value={f.code} onChange={set("code")} required /></label>}
        {view !== "forgot" && (
          <label>{view === "reset" ? "New password" : "Password"}
            <input type="password" value={f.password} onChange={set("password")} autoComplete="current-password" required />
          </label>
        )}
        {msg && <p className="note">{msg}</p>}
        <button className="primary" disabled={busy}>
          {{ login: "Log in", register: "Create account", forgot: "Send code", reset: "Change password" }[view]}
        </button>
        <div className="auth-links">
          {view === "login" ? <button type="button" className="link" onClick={() => go("register")}>Create an account</button>
            : <button type="button" className="link" onClick={() => go("login")}>Back to log in</button>}
          {view === "login" && <button type="button" className="link" onClick={() => go("forgot")}>Forgot password?</button>}
        </div>
      </form>
    </div>
  );
}

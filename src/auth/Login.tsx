
import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setErr("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: pw,
      });

      if (error) {
        setErr(error.message);
        return;
      }

      if (!data.session) {
        setErr("Sign-in returned no active session.");
      }
    } catch (error) {
      setErr(
        error instanceof Error ? error.message : "An unexpected error occurred."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Sign in</h2>
      <p className="lead">
        Orbit is private. Use the account your assistant created for you.
      </p>

      <label htmlFor="em">Email</label>
      <input
        id="em"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor="pw">Password</label>
      <input
        id="pw"
        type="password"
        autoComplete="current-password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void go()}
      />

      {err && (
        <div className="msg err" role="alert">
          {err}
        </div>
      )}

      <button
        className="p lg"
        disabled={busy || !email.trim() || !pw}
        onClick={() => void go()}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </div>
  );
}

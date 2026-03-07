"use client";

import { useState } from "react";
import { createSupabaseBrowserAuthClient } from "@/lib/supabase-auth";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("demo@irpf-parser.dev");
  const [password, setPassword] = useState("Demo2025!");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserAuthClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (signInError) {
        setError(signInError.message);
        setSubmitting(false);
        return;
      }

      window.location.assign(nextPath || "/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo iniciar sesión");
      setSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label htmlFor="login-email">Email</label>
      <input
        id="login-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
        disabled={submitting}
      />

      <label htmlFor="login-password">Contraseña</label>
      <input
        id="login-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        disabled={submitting}
      />

      <button type="submit" disabled={submitting}>
        {submitting ? "Entrando..." : "Entrar al despacho"}
      </button>

      {error ? <p className="badge danger">{error}</p> : null}
    </form>
  );
}

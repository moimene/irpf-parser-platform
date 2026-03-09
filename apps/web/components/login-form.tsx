"use client";

import { useState } from "react";
import { PROTOTYPE_SHARED_PASSWORD, type PrototypeTestUser } from "@/lib/prototype-test-users";
import { createSupabaseBrowserAuthClient } from "@/lib/supabase-auth";

export function LoginForm({
  nextPath,
  testUsers
}: {
  nextPath: string;
  testUsers: PrototypeTestUser[];
}) {
  const [email, setEmail] = useState(testUsers[0]?.email ?? "");
  const [password, setPassword] = useState(PROTOTYPE_SHARED_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedUserReference, setSelectedUserReference] = useState<string>(testUsers[0]?.reference ?? "");

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

  function handleUseCredentials(user: PrototypeTestUser) {
    setSelectedUserReference(user.reference);
    setEmail(user.email);
    setPassword(PROTOTYPE_SHARED_PASSWORD);
    setError(null);
  }

  return (
    <div className="login-grid">
      <form className="form login-panel" onSubmit={handleSubmit}>
        <div className="login-section-head">
          <div>
            <h2>Entrar con perfil de prueba</h2>
            <p className="muted" style={{ margin: 0 }}>
              Las credenciales de presentación están precargadas para acelerar el acceso de testers.
            </p>
          </div>
          <span className="badge info">Password común: {PROTOTYPE_SHARED_PASSWORD}</span>
        </div>

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

      <section className="login-panel">
        <div className="login-section-head">
          <div>
            <h2>Usuarios de test</h2>
            <p className="muted" style={{ margin: 0 }}>
              Cada perfil muestra una perspectiva distinta de la plataforma para presentación y validación.
            </p>
          </div>
        </div>

        <div className="login-tester-grid">
          {testUsers.map((user) => {
            const isSelected = selectedUserReference === user.reference;

            return (
              <article className={`login-tester-card${isSelected ? " active" : ""}`} key={user.reference}>
                <div className="login-tester-head">
                  <div>
                    <strong>{user.display_name}</strong>
                    <p className="muted" style={{ margin: "4px 0 0" }}>
                      {user.focus_label}
                    </p>
                  </div>
                  <span className="badge">{user.role_label}</span>
                </div>

                <p className="muted" style={{ margin: 0 }}>{user.summary}</p>

                <dl className="login-credentials">
                  <div>
                    <dt>Email</dt>
                    <dd>{user.email}</dd>
                  </div>
                  <div>
                    <dt>Password</dt>
                    <dd>{PROTOTYPE_SHARED_PASSWORD}</dd>
                  </div>
                </dl>

                <button
                  type="button"
                  className={isSelected ? "secondary" : undefined}
                  onClick={() => handleUseCredentials(user)}
                  disabled={submitting}
                >
                  {isSelected ? "Credenciales cargadas" : "Usar este acceso"}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

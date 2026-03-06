"use client";
import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

// Componente interno que usa useSearchParams — debe estar dentro de <Suspense>
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setError("Credenciales incorrectas. Verifique su correo y contraseña.");
      setLoading(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <div className="login-card">
      <div className="login-header">
        <div className="login-logo">G</div>
        <h1>Acceso al sistema</h1>
        <p className="muted">Plataforma fiscal IRPF · IP · 720</p>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <div className="field">
          <label htmlFor="email">Correo electrónico</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="nombre@despacho.com"
            disabled={loading}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            disabled={loading}
          />
        </div>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary login-submit"
          disabled={loading || !email || !password}
        >
          {loading ? "Verificando..." : "Entrar"}
        </button>
      </form>

        <div className="login-test-credentials">
          <p className="login-test-label">Acceso de demostración</p>
          <div className="login-test-row">
            <span className="login-test-field">Usuario</span>
            <code className="login-test-value">demo@irpf-parser.dev</code>
          </div>
          <div className="login-test-row">
            <span className="login-test-field">Contraseña</span>
            <code className="login-test-value">Demo2025!</code>
          </div>
          <button
            type="button"
            className="login-test-fill"
            onClick={() => {
              setEmail("demo@irpf-parser.dev");
              setPassword("Demo2025!");
            }}
          >
            Usar credenciales de demo
          </button>
        </div>

        <p className="login-footer">
          Acceso restringido a personal autorizado del despacho.
          <br />
          Para solicitar acceso contacte con el administrador del sistema.
        </p>
      </div>
  );
}

export default function LoginPage() {
  return (
    <div className="login-page">
      <Suspense fallback={<div className="login-card"><p className="muted">Cargando...</p></div>}>
        <LoginForm />
      </Suspense>

      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-bg-subtle, #f5f4f0);
        }
        .login-card {
          background: #fff;
          border: 1px solid var(--color-border, #d8d4cc);
          width: 100%;
          max-width: 400px;
          padding: 2.5rem 2rem;
        }
        .login-header {
          text-align: center;
          margin-bottom: 2rem;
        }
        .login-logo {
          width: 48px;
          height: 48px;
          background: var(--color-primary, #004438);
          color: #fff;
          font-size: 1.5rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1rem;
          font-family: 'Montserrat', sans-serif;
        }
        .login-header h1 {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--color-text, #1a1a1a);
          margin: 0 0 0.25rem;
        }
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .login-error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #991b1b;
          padding: 0.75rem 1rem;
          font-size: 0.85rem;
        }
        .login-submit {
          width: 100%;
          margin-top: 0.5rem;
        }
        .login-test-credentials {
          margin-top: 1.75rem;
          border-top: 1px solid var(--color-border, #d8d4cc);
          padding-top: 1.25rem;
        }
        .login-test-label {
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--color-muted, #888);
          margin: 0 0 0.75rem;
        }
        .login-test-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.4rem;
          font-size: 0.82rem;
        }
        .login-test-field {
          color: var(--color-muted, #888);
        }
        .login-test-value {
          font-family: 'Courier New', monospace;
          font-size: 0.82rem;
          background: #f5f4f0;
          padding: 2px 6px;
          border: 1px solid #e2ddd6;
          color: var(--color-text, #1a1a1a);
          user-select: all;
        }
        .login-test-fill {
          margin-top: 0.75rem;
          width: 100%;
          padding: 0.45rem 0;
          font-size: 0.8rem;
          font-family: 'Montserrat', sans-serif;
          font-weight: 500;
          background: transparent;
          border: 1px solid var(--color-border, #d8d4cc);
          color: var(--color-primary, #004438);
          cursor: pointer;
          transition: background 0.15s;
        }
        .login-test-fill:hover {
          background: #f5f4f0;
        }
        .login-footer {
          margin-top: 1.5rem;
          font-size: 0.75rem;
          color: var(--color-muted, #888);
          text-align: center;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}

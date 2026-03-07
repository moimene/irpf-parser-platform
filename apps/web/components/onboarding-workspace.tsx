"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserAuthClient } from "@/lib/supabase-auth";

type SessionPayload = {
  current_user: {
    display_name: string;
    email: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
    reference: string;
  };
};

const roleLabel: Record<SessionPayload["current_user"]["role"], string> = {
  admin: "Administrador",
  fiscal_senior: "Fiscal senior",
  fiscal_junior: "Fiscal junior",
  solo_lectura: "Solo lectura"
};

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function readHashSession() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken
  };
}

export function OnboardingWorkspace() {
  const [session, setSession] = useState<SessionPayload["current_user"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setLoading(true);
      try {
        const supabase = createSupabaseBrowserAuthClient();
        const hashSession = readHashSession();
        const hasRedirectTokens = Boolean(hashSession);

        if (hashSession) {
          const { error: setSessionError } = await supabase.auth.setSession(hashSession);
          if (setSessionError) {
            throw setSessionError;
          }

          const currentUrl = new URL(window.location.href);
          currentUrl.hash = "";
          window.history.replaceState(window.history.state, "", currentUrl.toString());
        }

        const {
          data: { session },
          error: sessionError
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session && hasRedirectTokens) {
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const {
              data: { user }
            } = await supabase.auth.getUser();

            if (user) {
              break;
            }

            await delay(250);
          }
        }

        let resolvedResponse: Response | null = null;
        let resolvedBody: SessionPayload | { error?: string } | null = null;

        for (let attempt = 0; attempt < (hasRedirectTokens ? 10 : 1); attempt += 1) {
          const response = await fetch("/api/session", {
            cache: "no-store",
            credentials: "same-origin"
          });
          const body = (await response.json()) as SessionPayload | { error?: string };

          if (response.ok) {
            resolvedResponse = response;
            resolvedBody = body;
            break;
          }

          resolvedResponse = response;
          resolvedBody = body;

          if (!hasRedirectTokens || response.status !== 401) {
            break;
          }

          await delay(250);
        }

        if (!cancelled) {
          if (!resolvedResponse?.ok || !resolvedBody) {
            setError(
              (resolvedBody as { error?: string } | null)?.error ??
                "El enlace ha caducado o tu perfil no está activo. Solicita uno nuevo al administrador."
            );
            setSession(null);
          } else {
            setSession((resolvedBody as SessionPayload).current_user);
            setError(null);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No se pudo validar el onboarding del usuario."
          );
          setSession(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (password !== passwordConfirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createSupabaseBrowserAuthClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password
      });

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }

      setSuccess("Contraseña actualizada. Redirigiendo al panel del despacho...");
      window.setTimeout(() => {
        window.location.assign("/");
      }, 800);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "No se pudo completar la actualización de contraseña."
      );
      setSaving(false);
      return;
    }

    setSaving(false);
  }

  if (loading) {
    return <p className="muted">Validando enlace seguro...</p>;
  }

  if (!session) {
    return (
      <>
        <p className="badge danger">
          {error ??
            "El enlace ha caducado o ya fue consumido. Solicita un nuevo onboarding o reset al administrador."}
        </p>
        <p className="muted">
          Si ya tienes una contraseña operativa, puedes volver al acceso principal del despacho.
        </p>
        <p>
          <Link href="/login">Volver a login</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <p className="muted">
        Usuario validado: <strong>{session.display_name}</strong> · {session.email} ·{" "}
        {roleLabel[session.role]}
      </p>
      <p className="muted">Perfil persistente: {session.reference}</p>

      <form className="form" onSubmit={handleSubmit}>
        <label htmlFor="onboarding-password">Nueva contraseña</label>
        <input
          id="onboarding-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={saving}
          minLength={8}
          required
        />

        <label htmlFor="onboarding-password-confirm">Repite la contraseña</label>
        <input
          id="onboarding-password-confirm"
          type="password"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(event) => setPasswordConfirm(event.target.value)}
          disabled={saving}
          minLength={8}
          required
        />

        <button type="submit" disabled={saving}>
          {saving ? "Guardando contraseña..." : "Activar acceso seguro"}
        </button>

        {error ? <p className="badge danger">{error}</p> : null}
        {success ? <p className="badge success">{success}</p> : null}
      </form>
    </>
  );
}

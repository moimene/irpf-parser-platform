"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserAuthClient } from "@/lib/supabase-auth";

type SessionPayload = {
  auth_mode: "supabase" | "demo";
  runtime_environment: "demo" | "sandbox" | "operational";
  current_user: {
    reference: string;
    display_name: string;
    email: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
  };
  available_users?: Array<{
    id: string;
    reference: string;
    display_name: string;
    email: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
  }>;
};

const roleLabel: Record<SessionPayload["current_user"]["role"], string> = {
  admin: "Administrador",
  fiscal_senior: "Fiscal senior",
  fiscal_junior: "Fiscal junior",
  solo_lectura: "Solo lectura"
};

const environmentLabel: Record<SessionPayload["runtime_environment"], string> = {
  demo: "Demo",
  sandbox: "Sandbox",
  operational: "Autenticado"
};

export function SessionSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const [payload, setPayload] = useState<SessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        const body = (await response.json()) as SessionPayload | { error: string };

        if (!response.ok) {
          if (mounted) {
            setError((body as { error: string }).error ?? "No se pudo cargar la sesión");
          }
          return;
        }

        if (mounted) {
          setPayload(body as SessionPayload);
          setError(null);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la sesión");
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextReference = event.target.value;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_reference: nextReference })
      });

      const body = (await response.json()) as SessionPayload | { error: string };
      if (!response.ok) {
        setError((body as { error: string }).error ?? "No se pudo cambiar la sesión");
        setSubmitting(false);
        return;
      }

      window.location.reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo cambiar la sesión");
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    setSubmitting(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserAuthClient();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        throw signOutError;
      }

      router.replace("/login");
      router.refresh();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "No se pudo cerrar sesión");
      setSubmitting(false);
    }
  }

  const currentUser = payload?.current_user;
  if (pathname === "/login") {
    return null;
  }

  return (
    <div className="session-switcher" aria-label="Sesión de usuario">
      <div className="session-summary">
        <span className="session-label">
          {payload ? `${environmentLabel[payload.runtime_environment]} · ${payload.auth_mode === "supabase" ? "Acceso autenticado" : "Acceso demo"}` : "Resolviendo sesión"}
        </span>
        <strong>{currentUser?.display_name ?? "Cargando sesión..."}</strong>
        <span className="muted">
          {currentUser ? `${roleLabel[currentUser.role]} · ${currentUser.email}` : "Resolviendo usuario actual"}
        </span>
      </div>

      {payload?.auth_mode === "demo" ? (
        <label className="session-control">
          <span className="session-label">Perfil demo</span>
          <select
            value={currentUser?.reference ?? ""}
            onChange={handleChange}
            disabled={submitting || !payload}
          >
            {!payload ? <option value="">Cargando...</option> : null}
            {payload?.available_users?.map((user) => (
              <option key={user.id} value={user.reference}>
                {user.display_name} · {roleLabel[user.role]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="session-control">
          <span className="session-label">Acción</span>
          <button type="button" className="secondary" onClick={() => void handleLogout()} disabled={submitting || !payload}>
            {submitting ? "Cerrando..." : "Cerrar sesión"}
          </button>
        </div>
      )}

      {error ? <span className="badge danger">{error}</span> : null}
    </div>
  );
}

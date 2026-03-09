import { LoginForm } from "@/components/login-form";
import { runtimeEnvironmentMeta } from "@/lib/env";
import { PROTOTYPE_SHARED_PASSWORD, PROTOTYPE_TEST_USERS } from "@/lib/prototype-test-users";
import { isSupabaseAuthEnabled } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export default function LoginPage({
  searchParams
}: {
  searchParams?: { next?: string; error?: string };
}) {
  const nextPath = searchParams?.next && searchParams.next.startsWith("/") ? searchParams.next : "/";
  const runtimeEnvironment = runtimeEnvironmentMeta();

  return (
    <div className="page">
      <section className="card" style={{ maxWidth: "1120px", margin: "0 auto" }}>
        <h1>Acceso al despacho</h1>
        <p className="muted">
          Prototipo de presentación para testers: acceso guiado a cartera, expedientes, revisión manual y modelos AEAT.
        </p>
        <p className={`badge ${runtimeEnvironment.kind === "operational" ? "success" : runtimeEnvironment.kind === "sandbox" ? "warning" : "info"}`}>
          {runtimeEnvironment.shortLabel}: {runtimeEnvironment.description}
        </p>
        <p className="badge warning">
          Dataset de presentación limpio. Todos los perfiles de test comparten la contraseña <strong>{PROTOTYPE_SHARED_PASSWORD}</strong>.
        </p>
        {searchParams?.error ? <p className="badge danger">{searchParams.error}</p> : null}

        {isSupabaseAuthEnabled() ? (
          <>
            <p className="muted">
              La autenticación se resuelve vía Supabase Auth y cada usuario entra con un perfil operativo ya asignado en la plataforma.
            </p>
            <LoginForm nextPath={nextPath} testUsers={PROTOTYPE_TEST_USERS} />
          </>
        ) : (
          <p className="badge warning">
            Este entorno funciona como sandbox local y no debe confundirse con el operativo real del despacho.
          </p>
        )}
      </section>
    </div>
  );
}

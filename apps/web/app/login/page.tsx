import { LoginForm } from "@/components/login-form";
import { isSupabaseAuthEnabled } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export default function LoginPage({
  searchParams
}: {
  searchParams?: { next?: string; error?: string };
}) {
  const nextPath = searchParams?.next && searchParams.next.startsWith("/") ? searchParams.next : "/";

  return (
    <div className="page">
      <section className="card" style={{ maxWidth: "560px", margin: "0 auto" }}>
        <h1>Acceso al despacho</h1>
        <p className="muted">
          Autenticación real sobre Supabase Auth para la consola IRPF/IP/720 del equipo fiscal.
        </p>
        {searchParams?.error ? <p className="badge danger">{searchParams.error}</p> : null}

        {isSupabaseAuthEnabled() ? (
          <>
            <p className="muted">
              Usuario demo operativo: <strong>demo@irpf-parser.dev</strong>
            </p>
            <LoginForm nextPath={nextPath} />
          </>
        ) : (
          <p className="badge warning">
            Supabase Auth no está configurado en este entorno local. La protección real se activa en el
            despliegue con variables públicas de Supabase.
          </p>
        )}
      </section>
    </div>
  );
}

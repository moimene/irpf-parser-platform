import { OnboardingWorkspace } from "@/components/onboarding-workspace";
import { isSupabaseAuthEnabled } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return (
    <div className="page">
      <section className="card" style={{ maxWidth: "640px", margin: "0 auto" }}>
        <h1>Onboarding seguro del despacho</h1>
        <p className="muted">
          Define tu contraseña inicial o restablécela desde un enlace de un solo uso emitido por la
          administración del despacho.
        </p>
        {isSupabaseAuthEnabled() ? (
          <OnboardingWorkspace />
        ) : (
          <p className="badge warning">
            Supabase Auth no está configurado en este entorno y no se puede completar el onboarding.
          </p>
        )}
      </section>
    </div>
  );
}

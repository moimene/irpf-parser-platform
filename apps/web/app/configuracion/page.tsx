import { AccessAdminWorkspace } from "@/components/access-admin-workspace";
import { runtimeEnvironmentMeta } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function ConfiguracionPage() {
  const runtimeEnvironment = runtimeEnvironmentMeta();

  return (
    <div className="page">
      <section className="card">
        <h1>Configuración y accesos</h1>
        <p className="muted">
          Administración del equipo del despacho, roles de operación y asignaciones por cliente para IRPF,
          Patrimonio y Modelo 720.
        </p>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Gobierno de entornos</h2>
            <p className="muted">
              Configuración solo cubre gobierno de plataforma, no trabajo operativo de expedientes.
            </p>
          </div>
        </div>
        <div className="model-overview-grid">
          {[
            {
              key: "demo",
              title: "Demo",
              detail: "Formación, demos comerciales y walkthroughs controlados. Nunca debe mezclarse con cartera real."
            },
            {
              key: "sandbox",
              title: "Sandbox",
              detail: "Validación funcional, QA y pruebas integradas con datos controlados antes de pasar a operación."
            },
            {
              key: "operational",
              title: "Acceso autenticado",
              detail: "Entorno con autenticación real, clientes asignados y trazabilidad gobernada, válido para presentación controlada o futura operación."
            }
          ].map((environment) => (
            <article className="stack-item" key={environment.key}>
              <div className="review-item-header">
                <h3>{environment.title}</h3>
                {runtimeEnvironment.kind === environment.key ? (
                  <span className="badge info">Entorno actual</span>
                ) : null}
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {environment.detail}
              </p>
            </article>
          ))}
        </div>
        <p className="muted" style={{ marginTop: "14px", marginBottom: 0 }}>
          Ahora mismo: <strong>{runtimeEnvironment.shortLabel}</strong>. {runtimeEnvironment.description}
        </p>
      </section>

      <section className="card">
        <h2>Qué queda fuera de configuración</h2>
        <div className="stack">
          <article className="stack-item">
            <h3>No pertenece a configuración</h3>
            <p className="muted" style={{ margin: 0 }}>
              Cartera, clientes, expedientes, revisión manual, registro canónico y preparación AEAT deben vivirse en
              sus workspaces operativos; no aquí.
            </p>
          </article>
          <article className="stack-item">
            <h3>Sí pertenece a configuración</h3>
            <p className="muted" style={{ margin: 0 }}>
              Usuarios, permisos, asignaciones, parámetros de plataforma e integraciones que gobiernan la operación del despacho.
            </p>
          </article>
        </div>
      </section>

      <AccessAdminWorkspace />
    </div>
  );
}

import { AccessAdminWorkspace } from "@/components/access-admin-workspace";

export const dynamic = "force-dynamic";

export default function ConfiguracionPage() {
  return (
    <div className="page">
      <section className="card">
        <h1>Configuración y accesos</h1>
        <p className="muted">
          Administración del equipo del despacho, roles de operación y asignaciones por cliente para IRPF,
          Patrimonio y Modelo 720.
        </p>
      </section>
      <AccessAdminWorkspace />
    </div>
  );
}

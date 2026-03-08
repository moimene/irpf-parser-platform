import { CanonicalRegistryWorkspace } from "@/components/canonical-registry-workspace";
import { ExpedienteSummary } from "@/components/expediente-summary";
import { ExportGenerator } from "@/components/export-generator";
import { FiscalAdjustmentsWorkspace } from "@/components/fiscal-adjustments-workspace";
import { IntakeForm } from "@/components/intake-form";

export const dynamic = "force-dynamic";

export default function ExpedientePage({ params }: { params: { id: string } }) {
  return (
    <div className="page">
      <section className="card">
        <h1>Expediente: {params.id}</h1>
        <p className="muted">
          Flujo operativo completo: ingesta de documentos, parseo, revisión manual y generación de artefactos AEAT.
        </p>
      </section>

      <ExpedienteSummary expedienteId={params.id} />
      <CanonicalRegistryWorkspace expedienteId={params.id} />
      <FiscalAdjustmentsWorkspace expedienteId={params.id} />
      <IntakeForm expedienteId={params.id} />
      <ExportGenerator expedienteId={params.id} />
    </div>
  );
}

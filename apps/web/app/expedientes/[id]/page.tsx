import { ExportGenerator } from "@/components/export-generator";
import { IntakeForm } from "@/components/intake-form";

export default function ExpedientePage({ params }: { params: { id: string } }) {
  return (
    <div className="page">
      <section className="card">
        <h1>Expediente: {params.id}</h1>
        <p className="muted">
          Flujo operativo completo: ingesta de documentos, parseo, revisión manual y generación de artefactos AEAT.
        </p>
      </section>

      <IntakeForm expedienteId={params.id} />
      <ExportGenerator expedienteId={params.id} />
    </div>
  );
}

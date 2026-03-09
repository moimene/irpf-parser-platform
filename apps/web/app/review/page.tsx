import { ReviewBoard } from "@/components/review-board";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return (
    <div className="page">
      <section className="card">
        <h1>Bandeja de trabajo</h1>
        <p className="muted">
          Cola operativa del fiscalista: prioridad, contexto de cliente/expediente, edición de registros y
          resolución de incidencias documentales y fiscales.
        </p>
      </section>
      <ReviewBoard />
    </div>
  );
}

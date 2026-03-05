import { ReviewBoard } from "@/components/review-board";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return (
    <div className="page">
      <section className="card">
        <h1>Bandeja de Revisión Manual</h1>
        <p className="muted">
          Supervisa documentos de baja confianza, incidencias de parsing y alertas fiscales pendientes de validación.
        </p>
      </section>
      <ReviewBoard />
    </div>
  );
}

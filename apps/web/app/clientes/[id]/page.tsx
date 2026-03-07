import { ClientProfile } from "@/components/client-profile";

export const dynamic = "force-dynamic";

export default function ClienteDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="page">
      <section className="card">
        <h1>Ficha de cliente</h1>
        <p className="muted">
          Vista operativa del cliente, con su cartera de expedientes y creación de nuevos expedientes por
          modelo y ejercicio.
        </p>
      </section>
      <ClientProfile clientId={params.id} />
    </div>
  );
}

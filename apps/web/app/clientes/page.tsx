import { ClientsWorkspace } from "@/components/clients-workspace";

export default function ClientesPage() {
  return (
    <div className="page">
      <section className="card">
        <h1>Clientes</h1>
        <p className="muted">
          Registro operativo de clientes del despacho, con vínculo directo a sus expedientes de IRPF,
          Patrimonio y Modelo 720.
        </p>
      </section>
      <ClientsWorkspace />
    </div>
  );
}

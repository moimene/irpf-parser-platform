import Link from "next/link";
import { DashboardStats } from "@/components/dashboard-stats";
import { createSupabaseServerClient, getAbogadoActual } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

async function getDashboardData() {
  try {
    const supabase = await createSupabaseServerClient();
    const abogado  = await getAbogadoActual(supabase);
    if (!abogado) return null;

    const [
      { count: totalClientes },
      { count: pendientesRevision },
      { count: alertasAbiertas },
      { data: ultimosDocumentos },
      { data: ultimosClientes },
    ] = await Promise.all([
      supabase.from("irpf_clients").select("*", { count: "exact", head: true }),
      supabase.from("irpf_documents").select("*", { count: "exact", head: true }).eq("status", "manual_review"),
      supabase.from("irpf_alerts").select("*", { count: "exact", head: true }).eq("resuelta", false),
      supabase.from("irpf_documents").select("id, filename, status, entity_type, created_at").order("created_at", { ascending: false }).limit(5),
      supabase.from("irpf_clients").select("id, full_name, nif, created_at").order("created_at", { ascending: false }).limit(5),
    ]);

    return {
      abogado,
      totalClientes:      totalClientes ?? 0,
      pendientesRevision: pendientesRevision ?? 0,
      alertasAbiertas:    alertasAbiertas ?? 0,
      ultimosDocumentos:  ultimosDocumentos ?? [],
      ultimosClientes:    ultimosClientes ?? [],
    };
  } catch {
    return null;
  }
}

const STATUS_LABELS: Record<string, string> = {
  uploaded:      "Subido",
  queued:        "En cola",
  processing:    "Procesando",
  manual_review: "Revision manual",
  completed:     "Completado",
  failed:        "Fallido",
};

const STATUS_CLASS: Record<string, string> = {
  uploaded:      "status-neutral",
  queued:        "status-neutral",
  processing:    "status-info",
  manual_review: "status-warning",
  completed:     "status-ok",
  failed:        "status-error",
};

export default async function HomePage() {
  const data = await getDashboardData();

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Panel de control</h1>
          {data?.abogado && (
            <p className="dashboard-subtitle">
              {data.abogado.nombre} &mdash; {data.abogado.rol}
            </p>
          )}
        </div>
        <div className="header-actions">
          <Link href="/clientes" className="btn-primary">Ver clientes</Link>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-label">Clientes</span>
          <strong className="kpi-value">{data?.totalClientes ?? 0}</strong>
        </div>
        <div className="kpi-card kpi-warning">
          <span className="kpi-label">Pendientes de revision</span>
          <strong className="kpi-value">{data?.pendientesRevision ?? 0}</strong>
        </div>
        <div className="kpi-card kpi-alert">
          <span className="kpi-label">Alertas fiscales abiertas</span>
          <strong className="kpi-value">{data?.alertasAbiertas ?? 0}</strong>
        </div>
      </div>

      <section className="dashboard-section">
        <h2 className="section-title">Estado operativo en tiempo real</h2>
        <DashboardStats />
      </section>

      <div className="dashboard-grid">
        <section className="dashboard-section">
          <div className="section-header">
            <h2 className="section-title">Ultimos documentos</h2>
            <Link href="/review" className="section-link">Ver cola de revision</Link>
          </div>
          {!data?.ultimosDocumentos?.length ? (
            <p className="empty-msg">Sin documentos procesados aun.</p>
          ) : (
            <table className="mini-table">
              <thead>
                <tr><th>Archivo</th><th>Entidad</th><th>Estado</th><th>Fecha</th></tr>
              </thead>
              <tbody>
                {(data.ultimosDocumentos as any[]).map((doc) => (
                  <tr key={doc.id}>
                    <td className="cell-filename" title={doc.filename}>{doc.filename}</td>
                    <td>{doc.entity_type ?? "—"}</td>
                    <td>
                      <span className={`status-badge ${STATUS_CLASS[doc.status] ?? "status-neutral"}`}>
                        {STATUS_LABELS[doc.status] ?? doc.status}
                      </span>
                    </td>
                    <td className="cell-date">{new Date(doc.created_at).toLocaleDateString("es-ES")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="dashboard-section">
          <div className="section-header">
            <h2 className="section-title">Clientes recientes</h2>
            <Link href="/clientes" className="section-link">Ver todos</Link>
          </div>
          {!data?.ultimosClientes?.length ? (
            <p className="empty-msg">Sin clientes registrados aun.</p>
          ) : (
            <table className="mini-table">
              <thead>
                <tr><th>Nombre</th><th>NIF</th><th>Alta</th><th></th></tr>
              </thead>
              <tbody>
                {(data.ultimosClientes as any[]).map((c) => (
                  <tr key={c.id}>
                    <td className="cell-primary">{c.full_name}</td>
                    <td className="cell-mono">{c.nif}</td>
                    <td className="cell-date">{new Date(c.created_at).toLocaleDateString("es-ES")}</td>
                    <td><Link href={`/clientes/${c.id}`} className="btn-link">Ver</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="dashboard-section stack-section">
        <h2 className="section-title">Infraestructura</h2>
        <div className="stack-grid">
          <article className="stack-item">
            <h3>Vercel</h3>
            <p>Frontend Next.js 14 con App Router. APIs de ingesta, revision y exportacion.</p>
          </article>
          <article className="stack-item">
            <h3>Railway</h3>
            <p>Parser service FastAPI con extractores por entidad bancaria y fallback LLM.</p>
          </article>
          <article className="stack-item">
            <h3>Supabase</h3>
            <p>Base de datos PostgreSQL con RLS por rol. Storage de PDFs originales. Auth.</p>
          </article>
          <article className="stack-item">
            <h3>n8n</h3>
            <p>Orquestacion de eventos parse.* y manual.review.required entre servicios.</p>
          </article>
        </div>
      </section>

      <style>{`
        .dashboard-page { padding: 1.5rem 2rem; max-width: 1200px; }
        .dashboard-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
        .dashboard-title { font-size: 1.4rem; font-weight: 700; color: var(--color-primary, #004438); margin: 0 0 0.25rem; }
        .dashboard-subtitle { font-size: 0.85rem; color: var(--color-muted, #888); margin: 0; }
        .header-actions { display: flex; gap: 0.75rem; }
        .kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
        .kpi-card { padding: 1rem 1.25rem; border: 1px solid var(--color-border, #d8d4cc); background: #fff; }
        .kpi-card.kpi-warning { border-left: 3px solid #d97706; }
        .kpi-card.kpi-alert   { border-left: 3px solid #dc2626; }
        .kpi-label { display: block; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-muted, #888); margin-bottom: 0.35rem; }
        .kpi-value { font-size: 1.75rem; font-weight: 700; font-family: 'Courier New', monospace; color: var(--color-primary, #004438); }
        .dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }
        .dashboard-section { background: #fff; border: 1px solid var(--color-border, #d8d4cc); padding: 1.25rem; margin-bottom: 1.5rem; }
        .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .section-title { font-size: 0.9rem; font-weight: 700; color: var(--color-primary, #004438); margin: 0 0 1rem; }
        .section-header .section-title { margin-bottom: 0; }
        .section-link { font-size: 0.8rem; color: var(--color-primary, #004438); text-decoration: underline; text-underline-offset: 3px; }
        .mini-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        .mini-table th { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--color-border, #d8d4cc); font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted, #888); }
        .mini-table td { padding: 0.45rem 0.5rem; border-bottom: 1px solid #f5f4f0; }
        .mini-table tr:last-child td { border-bottom: none; }
        .cell-filename { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cell-primary { font-weight: 600; }
        .cell-mono { font-family: 'Courier New', monospace; font-size: 0.78rem; }
        .cell-date { color: var(--color-muted, #888); white-space: nowrap; }
        .status-badge { font-size: 0.68rem; padding: 2px 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .status-neutral { background: #f0ede6; color: #666; }
        .status-info    { background: #dbeafe; color: #1d4ed8; }
        .status-warning { background: #fef3c7; color: #92400e; }
        .status-ok      { background: #d1fae5; color: #065f46; }
        .status-error   { background: #fee2e2; color: #991b1b; }
        .empty-msg { font-size: 0.82rem; color: var(--color-muted, #888); }
        .stack-section { margin-bottom: 0; }
        .stack-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
        .stack-item h3 { font-size: 0.85rem; font-weight: 700; color: var(--color-primary, #004438); margin: 0 0 0.35rem; }
        .stack-item p { font-size: 0.78rem; color: var(--color-muted, #888); margin: 0; line-height: 1.5; }
        .btn-primary { display: inline-block; padding: 0.45rem 1.1rem; background: var(--color-primary, #004438); color: #fff; font-size: 0.82rem; font-weight: 600; border: none; cursor: pointer; text-decoration: none; }
        .btn-link { font-size: 0.78rem; color: var(--color-primary, #004438); text-decoration: underline; text-underline-offset: 3px; }
        @media (max-width: 768px) {
          .dashboard-grid { grid-template-columns: 1fr; }
          .kpi-row { grid-template-columns: 1fr; }
          .stack-grid { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
    </div>
  );
}

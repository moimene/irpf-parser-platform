import Link from "next/link";
import { DashboardStats } from "@/components/dashboard-stats";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="page">
      <section className="card">
        <h1>Extractor-Parseador Fiscal IRPF / IP / 720</h1>
        <p>
          Operación end-to-end desplegada sobre <strong>Vercel + n8n + Railway + Supabase</strong>, con contratos de
          integración versionados para ingesta, parsing, revisión y exportación.
        </p>
        <p className="muted">
          El diseño sigue un patrón corporativo sobrio, orientado a despacho profesional: legibilidad alta,
          trazabilidad por expediente y control de riesgo operativo.
        </p>
        <p>
          <Link href="/expedientes/demo-irpf-2025">
            <strong>Abrir expediente demo</strong>
          </Link>
          {" · "}
          <Link href="/clientes">
            <strong>Entrar en clientes</strong>
          </Link>
        </p>
      </section>

      <section className="card">
        <h2>Estado operativo en tiempo real</h2>
        <DashboardStats />
      </section>

      <section className="card">
        <h2>Cobertura por capa</h2>
        <div className="stack">
          <article className="stack-item">
            <h3>Vercel · Front + APIs</h3>
            <p className="muted">App Router para intake, exportes y recepción de eventos de parsing.</p>
          </article>
          <article className="stack-item">
            <h3>Railway · Parser Service</h3>
            <p className="muted">Servicio `/parse-document` con salida normalizada, confianza y source spans.</p>
          </article>
          <article className="stack-item">
            <h3>Supabase · Datos</h3>
            <p className="muted">Modelo unificado para documentos, extracciones, alertas, exports y auditoría.</p>
          </article>
          <article className="stack-item">
            <h3>n8n · Orquestación</h3>
            <p className="muted">Eventos `parse.*` y `manual.review.required` para coordinación y control.</p>
          </article>
        </div>
      </section>
    </div>
  );
}

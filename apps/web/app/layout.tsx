import type { Metadata } from "next";
import Link from "next/link";
import { getAbogadoActual } from "@/lib/supabase-auth";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "IRPF Parser Console",
  description: "Consola para extracción y validación fiscal IRPF/IP/720",
};

const ROL_LABEL: Record<string, string> = {
  socio: "Socio",
  asociado: "Asociado",
  paralegal: "Paralegal",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const abogado = await getAbogadoActual().catch(() => null);

  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="app-frame">
          <aside className="sidebar" aria-label="Navegación principal">
            <div className="sidebar-brand">
              <strong>IRPF Parser</strong>
              <span>Consola fiscal corporativa</span>
            </div>
            <nav className="sidebar-nav">
              <Link href="/" className="sidebar-link">
                Dashboard operativo
              </Link>
              <Link href="/clientes" className="sidebar-link">
                Clientes
              </Link>
              <Link href="/review" className="sidebar-link">
                Revision manual
              </Link>
              <Link href="/configuracion" className="sidebar-link">
                Configuracion
              </Link>
            </nav>

            {abogado && (
              <div className="sidebar-user">
                <div className="sidebar-user-info">
                  <span className="sidebar-user-name">{abogado.nombre}</span>
                  <span className="sidebar-user-rol">
                    {ROL_LABEL[abogado.rol] ?? abogado.rol}
                  </span>
                </div>
                <form action="/api/auth/logout" method="POST">
                  <button type="submit" className="sidebar-logout">
                    Salir
                  </button>
                </form>
              </div>
            )}

            <div className="sidebar-meta">
              <span>Vercel · Railway · n8n · Supabase</span>
            </div>
          </aside>

          <div className="shell">
            <header className="topbar">
              <div>
                <p className="topbar-title">Panel de Control Fiscal</p>
                <p className="topbar-subtitle">Trazabilidad completa de extracción, reglas y exportación AEAT</p>
              </div>
              <div className="topbar-chips" aria-label="Estado del entorno">
                <span className="chip success">Producción</span>
                <span className="chip">Parser conectado</span>
                <span className="chip">Workflow n8n</span>
              </div>
            </header>
            <main className="main-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}

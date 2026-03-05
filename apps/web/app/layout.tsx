import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "IRPF Parser Console",
  description: "Consola para extracción y validación fiscal IRPF/IP/720",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
              <Link href="/expedientes/demo-irpf-2025" className="sidebar-link">
                Expediente demo
              </Link>
              <Link href="/review" className="sidebar-link">
                Revisión manual
              </Link>
            </nav>
            <div className="sidebar-meta">
              <span>Stack: Vercel · Railway · n8n · Supabase</span>
              <span>Normativa UX inspirada en guía Garrigues</span>
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

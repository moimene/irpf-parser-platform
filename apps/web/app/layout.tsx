import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import Link from "next/link";
import { SessionSwitcher } from "@/components/session-switcher";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap"
});

export const metadata: Metadata = {
  title: "IRPF Parser Console",
  description: "Consola para extracción y validación fiscal IRPF/IP/720",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={montserrat.className}>
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
              <Link href="/expedientes/demo-irpf-2025" className="sidebar-link">
                Expediente demo
              </Link>
              <Link href="/review" className="sidebar-link">
                Revisión manual
              </Link>
              <Link href="/configuracion" className="sidebar-link">
                Configuración
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
              <div className="topbar-actions">
                <SessionSwitcher />
                <div className="topbar-chips" aria-label="Estado del entorno">
                  <span className="chip success">Producción</span>
                  <span className="chip">Parser conectado</span>
                  <span className="chip">Workflow n8n</span>
                </div>
              </div>
            </header>
            <main className="main-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}

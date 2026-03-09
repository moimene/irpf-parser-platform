import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { PrimaryNav } from "@/components/primary-nav";
import { SessionSwitcher } from "@/components/session-switcher";
import { runtimeEnvironmentMeta } from "@/lib/env";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap"
});

export const metadata: Metadata = {
  title: "Plataforma Fiscal",
  description: "Por Activos IRPF-IP-720, gestor información. Cliente, expediente anual y modelos AEAT",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const runtimeEnvironment = runtimeEnvironmentMeta();

  return (
    <html lang="es" className={montserrat.className}>
      <body>
        <div className="app-frame">
          <aside className="sidebar" aria-label="Navegación principal">
            <div className="sidebar-brand">
              <strong>Plataforma Fiscal</strong>
              <span>Por Activos IRPF-IP-720, gestor información</span>
            </div>
            <PrimaryNav />
            <div className="sidebar-meta">
              <span>Entrada principal: cartera asignada y expedientes por ejercicio</span>
              <span>Documentos y parsing quedan subordinados al expediente</span>
              <span>Entorno actual: {runtimeEnvironment.shortLabel}</span>
            </div>
          </aside>

          <div className="shell">
            <header className="topbar">
              <div>
                <p className="topbar-title">Plataforma Fiscal</p>
                <p className="topbar-subtitle">Cliente, expediente anual y modelos AEAT · Por Activos IRPF-IP-720</p>
              </div>
              <div className="topbar-actions">
                <SessionSwitcher />
                <div className="topbar-chips" aria-label="Estado del entorno">
                  <span className={`chip env-${runtimeEnvironment.kind}`}>{runtimeEnvironment.shortLabel}</span>
                  <span className="chip">Cartera</span>
                  <span className="chip">Expedientes</span>
                  <span className="chip">Modelos AEAT</span>
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

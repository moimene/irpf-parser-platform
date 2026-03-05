"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // En producción, aquí se enviaría el error a un servicio de monitorización
    console.error("[IRPF Parser] Error de aplicación:", error);
  }, [error]);

  return (
    <div className="page">
      <section className="card">
        <h1>Error de aplicación</h1>
        <p className="muted">
          Se ha producido un error inesperado. Si el problema persiste, contacte con el equipo técnico.
        </p>
        {error.digest && (
          <p className="muted" style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
            Referencia: {error.digest}
          </p>
        )}
        <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
          <button type="button" onClick={reset}>
            Reintentar
          </button>
          <Link href="/">
            <strong>Volver al panel</strong>
          </Link>
        </div>
      </section>
    </div>
  );
}

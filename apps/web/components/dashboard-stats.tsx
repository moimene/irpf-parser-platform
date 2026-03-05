"use client";

import { useEffect, useState } from "react";

type DashboardPayload = {
  queued: number;
  processing: number;
  manualReview: number;
  completed: number;
  failed: number;
  openAlerts: number;
  exports: number;
};

const initialState: DashboardPayload = {
  queued: 0,
  processing: 0,
  manualReview: 0,
  completed: 0,
  failed: 0,
  openAlerts: 0,
  exports: 0
};

export function DashboardStats() {
  const [state, setState] = useState<DashboardPayload>(initialState);

  useEffect(() => {
    let mounted = true;

    async function run() {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        if (!response.ok || !mounted) {
          return;
        }

        const payload = (await response.json()) as DashboardPayload;
        setState(payload);
      } catch {
        // No-op: en local sin backend externo no bloqueamos UI.
      }
    }

    void run();
    const intervalId = window.setInterval(() => void run(), 3500);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="kpi-grid">
      <article className="kpi">
        <span>En cola</span>
        <strong>{state.queued}</strong>
      </article>
      <article className="kpi">
        <span>Procesando</span>
        <strong>{state.processing}</strong>
      </article>
      <article className="kpi">
        <span>Revisión manual</span>
        <strong>{state.manualReview}</strong>
      </article>
      <article className="kpi">
        <span>Completados</span>
        <strong>{state.completed}</strong>
      </article>
      <article className="kpi">
        <span>Fallidos</span>
        <strong>{state.failed}</strong>
      </article>
      <article className="kpi">
        <span>Alertas abiertas</span>
        <strong>{state.openAlerts}</strong>
      </article>
      <article className="kpi">
        <span>Exportaciones</span>
        <strong>{state.exports}</strong>
      </article>
      <article className="kpi">
        <span>Objetivo batch/hora</span>
        <strong>50</strong>
      </article>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

type AdjustmentType = "COST_BASIS" | "INHERITANCE" | "TRANSFER_IN" | "TRANSFER_OUT";

type AdjustmentItem = {
  id: string;
  adjustment_type: AdjustmentType;
  status: "ACTIVE" | "ARCHIVED";
  target_operation_id: string | null;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | null;
  total_amount: number | null;
  currency: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
};

type PurchaseCandidate = {
  id: string;
  operation_date: string;
  isin: string | null;
  description: string;
  quantity: number;
  amount: number;
  currency: string | null;
  source: string;
};

type AdjustmentsPayload = {
  adjustments: AdjustmentItem[];
  purchase_candidates: PurchaseCandidate[];
};

const emptyPayload: AdjustmentsPayload = {
  adjustments: [],
  purchase_candidates: []
};

function badgeClass(type: string): string {
  if (type === "COST_BASIS") return "badge warning";
  if (type === "TRANSFER_OUT") return "badge danger";
  return "badge success";
}

function formatNumber(value: number | null, digits = 6): string {
  if (value === null) return "-";

  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value);
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null) {
    return "-";
  }

  const resolvedCurrency = currency?.trim().toUpperCase() || "EUR";

  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: resolvedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${formatNumber(value, 2)} ${resolvedCurrency}`;
  }
}

export function FiscalAdjustmentsWorkspace({ expedienteId }: { expedienteId: string }) {
  const [payload, setPayload] = useState<AdjustmentsPayload>(emptyPayload);
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("COST_BASIS");
  const [targetOperationId, setTargetOperationId] = useState("");
  const [operationDate, setOperationDate] = useState(new Date().toISOString().slice(0, 10));
  const [isin, setIsin] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/expedientes/${expedienteId}/adjustments`, {
      cache: "no-store"
    });
    const body = (await response.json()) as AdjustmentsPayload | { error: string };
    if (!response.ok) {
      setError((body as { error: string }).error ?? "No se pudieron cargar los ajustes fiscales");
      return;
    }

    setPayload(body as AdjustmentsPayload);
    setError(null);
  }, [expedienteId]);

  useEffect(() => {
    void load();

    const refreshListener = () => void load();
    window.addEventListener("expediente:refresh", refreshListener);

    return () => {
      window.removeEventListener("expediente:refresh", refreshListener);
    };
  }, [load]);

  useEffect(() => {
    if (adjustmentType !== "COST_BASIS") {
      return;
    }

    const selectedPurchase = payload.purchase_candidates.find(
      (candidate) => candidate.id === targetOperationId
    );

    if (!selectedPurchase) {
      return;
    }

    setOperationDate(selectedPurchase.operation_date);
    setIsin(selectedPurchase.isin ?? "");
    setDescription(selectedPurchase.description ?? "");
    setQuantity(selectedPurchase.quantity > 0 ? String(selectedPurchase.quantity) : "");
    setTotalAmount(selectedPurchase.amount > 0 ? String(selectedPurchase.amount) : "");
    setCurrency(selectedPurchase.currency ?? "EUR");
  }, [adjustmentType, payload.purchase_candidates, targetOperationId]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/expedientes/${expedienteId}/adjustments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          adjustment_type: adjustmentType,
          target_operation_id: targetOperationId || null,
          operation_date: operationDate,
          isin: isin || null,
          description: description || null,
          quantity: quantity ? Number(quantity) : null,
          total_amount: totalAmount ? Number(totalAmount) : null,
          currency: currency || null,
          notes: notes || null
        })
      });

      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "No se pudo guardar el ajuste fiscal");
        return;
      }

      setTargetOperationId("");
      setOperationDate(new Date().toISOString().slice(0, 10));
      setIsin("");
      setDescription("");
      setQuantity("");
      setTotalAmount("");
      setCurrency("EUR");
      setNotes("");
      await load();
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo guardar el ajuste fiscal");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(adjustmentId: string) {
    setDeletingId(adjustmentId);
    setError(null);

    try {
      const response = await fetch(`/api/expedientes/${expedienteId}/adjustments/${adjustmentId}`, {
        method: "DELETE"
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "No se pudo eliminar el ajuste fiscal");
        return;
      }

      await load();
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el ajuste fiscal");
    } finally {
      setDeletingId(null);
    }
  }

  const needsAcquisitionFields =
    adjustmentType === "INHERITANCE" || adjustmentType === "TRANSFER_IN";
  const needsTransferOutFields = adjustmentType === "TRANSFER_OUT";
  const needsCostTarget = adjustmentType === "COST_BASIS";

  return (
    <section className="card">
      <h2>Ajustes fiscales manuales</h2>
      <p className="muted">
        Herencias, transferencias y correcciones de coste viven aquí como objetos de negocio y recalculan FIFO,
        pérdidas bloqueadas y validación del modelo 100.
      </p>

      <form className="form" onSubmit={handleCreate}>
        <label htmlFor="adjustment-type">Tipo de ajuste</label>
        <select
          id="adjustment-type"
          value={adjustmentType}
          onChange={(event) => setAdjustmentType(event.target.value as AdjustmentType)}
        >
          <option value="COST_BASIS">Corrección de coste</option>
          <option value="INHERITANCE">Herencia</option>
          <option value="TRANSFER_IN">Transferencia de entrada</option>
          <option value="TRANSFER_OUT">Transferencia de salida</option>
        </select>

        {needsCostTarget ? (
          <>
            <label htmlFor="target-operation">Compra objetivo</label>
            <select
              id="target-operation"
              value={targetOperationId}
              onChange={(event) => setTargetOperationId(event.target.value)}
            >
              <option value="">Selecciona una compra</option>
              {payload.purchase_candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.operation_date} · {candidate.isin ?? "Sin ISIN"} · {candidate.description}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <label htmlFor="adjustment-date">Fecha efectiva</label>
        <input
          id="adjustment-date"
          type="date"
          value={operationDate}
          onChange={(event) => setOperationDate(event.target.value)}
        />

        <label htmlFor="adjustment-isin">ISIN</label>
        <input
          id="adjustment-isin"
          type="text"
          value={isin}
          onChange={(event) => setIsin(event.target.value.toUpperCase())}
          placeholder="Ej: US0378331005"
        />

        <label htmlFor="adjustment-description">Descripción</label>
        <input
          id="adjustment-description"
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Detalle visible en lotes y resumen fiscal"
        />

        {!needsTransferOutFields ? (
          <>
            <label htmlFor="adjustment-quantity">
              Cantidad {needsCostTarget ? "(opcional si mantienes la original)" : ""}
            </label>
            <input
              id="adjustment-quantity"
              type="number"
              step="0.000001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />

            <label htmlFor="adjustment-total">
              Coste total {needsCostTarget ? "(opcional si mantienes el original)" : ""}
            </label>
            <input
              id="adjustment-total"
              type="number"
              step="0.01"
              value={totalAmount}
              onChange={(event) => setTotalAmount(event.target.value)}
            />

            <label htmlFor="adjustment-currency">Divisa</label>
            <input
              id="adjustment-currency"
              type="text"
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              maxLength={6}
            />
          </>
        ) : (
          <>
            <label htmlFor="adjustment-quantity-transfer">Cantidad a transferir</label>
            <input
              id="adjustment-quantity-transfer"
              type="number"
              step="0.000001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </>
        )}

        <label htmlFor="adjustment-notes">Notas internas</label>
        <textarea
          id="adjustment-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          placeholder="Motivo del ajuste o referencia interna"
        />

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "8px" }}>
          <button type="submit" disabled={submitting}>
            {submitting ? "Guardando..." : "Guardar ajuste"}
          </button>
        </div>
      </form>

      {error ? <p className="badge danger" style={{ marginTop: "12px" }}>{error}</p> : null}

      <div style={{ marginTop: "18px" }}>
        <h3 style={{ marginBottom: "12px" }}>Ajustes activos del expediente</h3>
        {payload.adjustments.length === 0 ? (
          <p className="muted">Todavía no hay ajustes manuales persistidos.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Fecha</th>
                  <th>Activo</th>
                  <th>Impacto</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {payload.adjustments.map((adjustment) => (
                  <tr key={adjustment.id}>
                    <td>
                      <span className={badgeClass(adjustment.adjustment_type)}>
                        {adjustment.adjustment_type}
                      </span>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {adjustment.status} · {adjustment.created_by ?? "sistema"}
                      </div>
                    </td>
                    <td>{new Date(adjustment.operation_date).toLocaleDateString("es-ES")}</td>
                    <td>
                      <strong>{adjustment.isin ?? "Sin ISIN"}</strong>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {adjustment.description ?? adjustment.notes ?? "Sin descripción"}
                      </div>
                    </td>
                    <td>
                      <div>{formatNumber(adjustment.quantity)}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {formatCurrency(adjustment.total_amount, adjustment.currency)}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                        disabled={deletingId === adjustment.id}
                        onClick={() => handleDelete(adjustment.id)}
                      >
                        {deletingId === adjustment.id ? "..." : "Eliminar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

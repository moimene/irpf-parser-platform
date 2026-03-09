import { NextResponse } from "next/server";
import { accessErrorMessage, accessErrorStatus, getCurrentSessionUser, listAccessibleClientIds, requirePermission } from "@/lib/auth";
import { summarizeCanonicalAssets } from "@/lib/canonical-exports";
import { loadPersistedCanonicalExpedienteView } from "@/lib/canonical-store";
import { listClientsCompat } from "@/lib/client-store";
import { dbTables } from "@/lib/db-tables";
import { deriveCanonicalAssetViews } from "@/lib/fiscal-canonical";
import { resolveFiscalUnitState } from "@/lib/fiscal-unit-state";
import {
  assessModel714Requirement,
  assessModel720Requirement,
  foreignBlockTotalsFromPayload
} from "@/lib/model-filing-rules";
import {
  buildExpedienteWorkflowSnapshot,
  loadPersistedExpedienteWorkflowMap
} from "@/lib/expediente-workflow";
import { comparePreparationStatus, evaluateModelPreparation } from "@/lib/model-preparation";
import type { ModelWorkspaceItem, ModelWorkspaceOverview, ModelWorkspacePayload } from "@/lib/model-workspace";
import { emptyModelWorkspacePayload } from "@/lib/model-workspace";
import { modelPreparationExportModel } from "@/lib/model-preparation";
import { summarizeSalesFromOperations, type PersistedSaleAllocationRow, type RuntimeOperationRow } from "@/lib/lots";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type ExpedienteRow = {
  id: string;
  reference: string;
  client_id: string | null;
  fiscal_year: number;
  model_type: "IRPF" | "IP" | "720";
  title: string;
  status: string;
  updated_at: string;
};

type DocumentRow = {
  expediente_id: string;
  processing_status: "queued" | "processing" | "manual_review" | "completed" | "failed";
  updated_at: string | null;
  created_at: string;
};

type AlertRow = {
  expediente_id: string;
  severity: "info" | "warning" | "critical";
  created_at: string;
};

type ExportRow = {
  expediente_id: string;
  model: "100" | "714" | "720";
  status: string;
  validation_state: string;
  payload: Record<string, unknown> | null;
  generated_at: string | null;
  created_at: string;
};

type OperationRow = {
  id: string;
  expediente_id: string;
  operation_type: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  amount: number | string | null;
  currency: string | null;
  quantity: number | string | null;
  retention: number | string | null;
  realized_gain: number | string | null;
  source: string;
  manual_notes: string | null;
  created_at: string;
};

type LotRow = {
  id: string;
  expediente_id: string;
  isin: string;
  description: string | null;
  quantity_open: number | string;
  total_cost: number | string | null;
  currency: string | null;
  status: "OPEN" | "CLOSED";
};

type AllocationRow = {
  sale_operation_id: string;
  quantity: number | string;
  sale_amount_allocated: number | string | null;
  total_cost: number | string | null;
  realized_gain: number | string | null;
  acquisition_date: string;
  acquisition_operation_id: string | null;
  currency: string | null;
};

type CanonicalView = ReturnType<typeof deriveCanonicalAssetViews>;

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) {
    return null;
  }

  return [...valid].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function latestExportRow(rows: ExportRow[], model: "100" | "714" | "720"): ExportRow | null {
  return (
    [...rows]
      .filter((row) => row.model === model)
      .sort((left, right) => {
        return new Date(right.generated_at ?? right.created_at).getTime() - new Date(left.generated_at ?? left.created_at).getTime();
      })[0] ?? null
  );
}

function countForeignTransmissionEvents(view: CanonicalView): number {
  const countriesByAssetKey = new Map(view.assets.map((asset) => [asset.asset_key, asset.country]));
  return view.fiscalEvents.filter((event) => {
    if (event.event_kind !== "transmision") {
      return false;
    }

    const country = countriesByAssetKey.get(event.asset_key);
    return Boolean(country && country !== "ES");
  }).length;
}

function buildEmptyPayload(currentUser: ModelWorkspacePayload["current_user"]): ModelWorkspacePayload {
  return {
    ...emptyModelWorkspacePayload,
    current_user: currentUser,
    overview: [
      { model_type: "IRPF", export_model: "100", expedientes: 0, ready: 0, attention: 0, blocked: 0, exports: 0 },
      { model_type: "IP", export_model: "714", expedientes: 0, ready: 0, attention: 0, blocked: 0, exports: 0 },
      { model_type: "720", export_model: "720", expedientes: 0, ready: 0, attention: 0, blocked: 0, exports: 0 }
    ]
  };
}

function nextActionHref(item: {
  nextTarget: "client" | "documental" | "revision" | "canonico" | "modelos";
  clientReference: string | null;
  expedienteReference: string;
}): string {
  if (item.nextTarget === "client" && item.clientReference) {
    return `/clientes/${item.clientReference}`;
  }

  if (item.nextTarget === "client") {
    return `/expedientes/${item.expedienteReference}`;
  }

  return item.nextTarget === "modelos"
    ? `/expedientes/${item.expedienteReference}?fase=modelos`
    : `/expedientes/${item.expedienteReference}?fase=${item.nextTarget}`;
}

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "dashboard.read");

    const currentUser = {
      reference: sessionUser.reference,
      display_name: sessionUser.display_name,
      role: sessionUser.role
    } as const;

    const accessibleClientIds = await listAccessibleClientIds(supabase, sessionUser);
    const allClients = await listClientsCompat(supabase);
    const clients =
      sessionUser.role === "admin"
        ? allClients
        : allClients.filter((client) => accessibleClientIds.includes(client.id));

    if (clients.length === 0) {
      return NextResponse.json(buildEmptyPayload(currentUser));
    }

    const clientIds = clients.map((client) => client.id);
    const { data: expedientesData, error: expedientesError } = await supabase
      .from(dbTables.expedientes)
      .select("id, reference, client_id, fiscal_year, model_type, title, status, updated_at")
      .in("client_id", clientIds)
      .order("fiscal_year", { ascending: false });

    if (expedientesError) {
      throw new Error(`No se pudieron cargar expedientes declarativos: ${expedientesError.message}`);
    }

    const expedientes = (expedientesData ?? []) as ExpedienteRow[];
    if (expedientes.length === 0) {
      return NextResponse.json(buildEmptyPayload(currentUser));
    }

    const expedienteIds = expedientes.map((item) => item.id);
    const [documentsResult, alertsResult, exportsResult, operationsResult, lotsResult, allocationsResult] =
      await Promise.all([
        supabase
          .from(dbTables.documents)
          .select("expediente_id, processing_status, updated_at, created_at")
          .in("expediente_id", expedienteIds),
        supabase
          .from(dbTables.alerts)
          .select("expediente_id, severity, created_at")
          .eq("status", "open")
          .in("expediente_id", expedienteIds),
        supabase
          .from(dbTables.exports)
          .select("expediente_id, model, status, validation_state, payload, generated_at, created_at")
          .in("expediente_id", expedienteIds),
        supabase
          .from(dbTables.operations)
          .select(
            "id, expediente_id, operation_type, operation_date, isin, description, amount, currency, quantity, retention, realized_gain, source, manual_notes, created_at"
          )
          .in("expediente_id", expedienteIds),
        supabase
          .from(dbTables.lots)
          .select("id, expediente_id, isin, description, quantity_open, total_cost, currency, status")
          .in("expediente_id", expedienteIds),
        supabase
          .from(dbTables.saleAllocations)
          .select(
            "sale_operation_id, quantity, sale_amount_allocated, total_cost, realized_gain, acquisition_date, acquisition_operation_id, currency"
          )
          .in("expediente_id", expedienteIds)
      ]);

    if (
      documentsResult.error ||
      alertsResult.error ||
      exportsResult.error ||
      operationsResult.error ||
      lotsResult.error ||
      allocationsResult.error
    ) {
      throw new Error(
        documentsResult.error?.message ??
          alertsResult.error?.message ??
          exportsResult.error?.message ??
          operationsResult.error?.message ??
          lotsResult.error?.message ??
          allocationsResult.error?.message ??
          "No se pudo cargar el workspace declarativo"
      );
    }

    const documentsByExpediente = new Map<string, DocumentRow[]>();
    for (const document of (documentsResult.data ?? []) as DocumentRow[]) {
      const items = documentsByExpediente.get(document.expediente_id) ?? [];
      items.push(document);
      documentsByExpediente.set(document.expediente_id, items);
    }

    const alertsByExpediente = new Map<string, AlertRow[]>();
    for (const alert of (alertsResult.data ?? []) as AlertRow[]) {
      const items = alertsByExpediente.get(alert.expediente_id) ?? [];
      items.push(alert);
      alertsByExpediente.set(alert.expediente_id, items);
    }

    const exportsByExpediente = new Map<string, ExportRow[]>();
    for (const exportRow of (exportsResult.data ?? []) as ExportRow[]) {
      const items = exportsByExpediente.get(exportRow.expediente_id) ?? [];
      items.push(exportRow);
      exportsByExpediente.set(exportRow.expediente_id, items);
    }

    const operationsByExpediente = new Map<string, OperationRow[]>();
    for (const operation of (operationsResult.data ?? []) as OperationRow[]) {
      const items = operationsByExpediente.get(operation.expediente_id) ?? [];
      items.push(operation);
      operationsByExpediente.set(operation.expediente_id, items);
    }

    const lotsByExpediente = new Map<string, LotRow[]>();
    for (const lot of (lotsResult.data ?? []) as LotRow[]) {
      const items = lotsByExpediente.get(lot.expediente_id) ?? [];
      items.push(lot);
      lotsByExpediente.set(lot.expediente_id, items);
    }

    const operationById = new Map(
      ((operationsResult.data ?? []) as OperationRow[]).map((operation) => [operation.id, operation])
    );
    const allocationsByExpediente = new Map<string, AllocationRow[]>();
    for (const allocation of (allocationsResult.data ?? []) as AllocationRow[]) {
      const saleOperation = operationById.get(allocation.sale_operation_id);
      if (!saleOperation) {
        continue;
      }

      const items = allocationsByExpediente.get(saleOperation.expediente_id) ?? [];
      items.push(allocation);
      allocationsByExpediente.set(saleOperation.expediente_id, items);
    }

    const saleSummariesByExpediente = new Map(
      expedientes.map((expediente) => {
        const operations = (operationsByExpediente.get(expediente.id) ?? []) as RuntimeOperationRow[];
        const allocations = (allocationsByExpediente.get(expediente.id) ?? []) as PersistedSaleAllocationRow[];
        return [
          expediente.id,
          summarizeSalesFromOperations({
            operations,
            allocations
          })
        ] as const;
      })
    );

    const expedientesByClientId = new Map<string, ExpedienteRow[]>();
    for (const expediente of expedientes) {
      if (!expediente.client_id) {
        continue;
      }

      const items = expedientesByClientId.get(expediente.client_id) ?? [];
      items.push(expediente);
      expedientesByClientId.set(expediente.client_id, items);
    }

    const canonicalEntries = await Promise.all(
      expedientes.map(async (expediente) => {
        const derivedCanonicalView = deriveCanonicalAssetViews({
          operations: (operationsByExpediente.get(expediente.id) ?? []).map((row) => ({
            id: row.id,
            expediente_id: row.expediente_id,
            operation_type: row.operation_type,
            operation_date: row.operation_date,
            isin: row.isin,
            description: row.description ?? row.manual_notes,
            amount: toNullableNumber(row.amount),
            currency: row.currency,
            quantity: toNullableNumber(row.quantity),
            retention: toNullableNumber(row.retention),
            realized_gain: toNullableNumber(row.realized_gain),
            source: row.source
          })),
          lots: (lotsByExpediente.get(expediente.id) ?? []).map((row) => ({
            id: row.id,
            expediente_id: expediente.id,
            isin: row.isin,
            description: row.description,
            quantity_open: toNullableNumber(row.quantity_open) ?? 0,
            total_cost: toNullableNumber(row.total_cost),
            currency: row.currency,
            status: row.status
          })),
          saleSummaries: (saleSummariesByExpediente.get(expediente.id) ?? []).map((summary) => ({
            sale_operation_id: summary.sale_operation_id,
            operation_date: summary.operation_date,
            isin: summary.isin,
            description: summary.description,
            quantity: summary.quantity,
            sale_amount: summary.sale_amount,
            cost_basis: summary.cost_basis,
            realized_gain: summary.realized_gain,
            currency: summary.currency,
            status: summary.status,
            source: summary.source
          })),
          expedienteMetaById: new Map([
            [
              expediente.id,
              {
                reference: expediente.reference,
                fiscal_year: expediente.fiscal_year,
                model_type: expediente.model_type
              }
            ]
          ])
        });

        const persistedCanonicalView = await loadPersistedCanonicalExpedienteView(supabase, {
          clientId: expediente.client_id,
          expedienteId: expediente.id,
          expedienteReference: expediente.reference
        });

        return [expediente.id, persistedCanonicalView ?? derivedCanonicalView] as const;
      })
    );

    const canonicalByExpediente = new Map<string, CanonicalView>(canonicalEntries);
    const assetMetricsByExpediente = new Map(
      expedientes.map((expediente) => {
        const canonicalView = canonicalByExpediente.get(expediente.id) ?? { assets: [], fiscalEvents: [] };
        return [expediente.id, summarizeCanonicalAssets({ assets: canonicalView.assets })] as const;
      })
    );
    const foreignTransmissionEventsByExpediente = new Map(
      expedientes.map((expediente) => {
        const canonicalView = canonicalByExpediente.get(expediente.id) ?? { assets: [], fiscalEvents: [] };
        return [expediente.id, countForeignTransmissionEvents(canonicalView)] as const;
      })
    );

    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const workflowMap = await loadPersistedExpedienteWorkflowMap(supabase, expedienteIds);

    const workItems: ModelWorkspaceItem[] = expedientes
      .map((expediente) => {
        const client = expediente.client_id ? clientsById.get(expediente.client_id) ?? null : null;
        const fiscalUnitState = resolveFiscalUnitState(client?.fiscal_unit ?? null);
        const documents = documentsByExpediente.get(expediente.id) ?? [];
        const alerts = alertsByExpediente.get(expediente.id) ?? [];
        const exports = (exportsByExpediente.get(expediente.id) ?? []).sort((left, right) => {
          return new Date(right.generated_at ?? right.created_at).getTime() - new Date(left.generated_at ?? left.created_at).getTime();
        });
        const operations = operationsByExpediente.get(expediente.id) ?? [];
        const saleSummaries = saleSummariesByExpediente.get(expediente.id) ?? [];
        const canonicalView = canonicalByExpediente.get(expediente.id) ?? { assets: [], fiscalEvents: [] };
        const expedienteAssets = canonicalView.assets;
        const assetMetrics = assetMetricsByExpediente.get(expediente.id) ?? summarizeCanonicalAssets({ assets: expedienteAssets });
        const pendingReview = documents.filter((document) =>
          document.processing_status === "manual_review" || document.processing_status === "failed"
        ).length;
        const pendingSales = saleSummaries.filter((sale) => sale.status !== "MATCHED").length;
        const model714Requirement =
          expediente.model_type === "IP"
            ? assessModel714Requirement({
                totalValuation: assetMetrics.totalValuation
              })
            : null;
        const previousFiled720Expediente =
          expediente.model_type === "720" && client
            ? [...(expedientesByClientId.get(client.id) ?? [])]
                .filter((candidate) => candidate.model_type === "720" && candidate.fiscal_year < expediente.fiscal_year)
                .filter((candidate) => latestExportRow(exportsByExpediente.get(candidate.id) ?? [], "720"))
                .sort((left, right) => right.fiscal_year - left.fiscal_year)[0] ?? null
            : null;
        const previousFiled720Export = previousFiled720Expediente
          ? latestExportRow(exportsByExpediente.get(previousFiled720Expediente.id) ?? [], "720")
          : null;
        const model720Requirement =
          expediente.model_type === "720"
            ? assessModel720Requirement({
                metrics: assetMetrics,
                priorFiledYear: previousFiled720Expediente?.fiscal_year ?? null,
                previousBlockTotals:
                  foreignBlockTotalsFromPayload(previousFiled720Export?.payload) ??
                  (previousFiled720Expediente
                    ? assetMetricsByExpediente.get(previousFiled720Expediente.id)?.foreignBlockTotals ?? null
                    : null),
                foreignTransmissionEvents: foreignTransmissionEventsByExpediente.get(expediente.id) ?? 0
              })
            : null;
        const workflow = buildExpedienteWorkflowSnapshot({
          expediente_id: expediente.id,
          expediente_status: expediente.status,
          has_client: Boolean(client),
          counts: {
            documents: documents.length,
            queued: documents.filter((document) => document.processing_status === "queued").length,
            processing: documents.filter((document) => document.processing_status === "processing").length,
            manual_review: pendingReview,
            failed: documents.filter((document) => document.processing_status === "failed").length,
            operations: operations.length,
            assets: assetMetrics.totalAssets,
            fiscal_events: saleSummaries.length,
            exports: exports.length,
            sales_pending: pendingSales
          },
          persisted: workflowMap.get(expediente.id) ?? null
        });

        const preparation = evaluateModelPreparation({
          model_type: expediente.model_type,
          has_client: Boolean(client),
          client_nif: client?.nif ?? null,
          fiscal_unit: client?.fiscal_unit ?? null,
          counts: {
            documents: documents.length,
            pending_review: pendingReview,
            open_alerts: alerts.length,
            operations: operations.length,
            assets: assetMetrics.totalAssets,
            foreign_assets: assetMetrics.foreignAssets,
            missing_asset_values: assetMetrics.missingValuationAssets,
            missing_foreign_values: assetMetrics.missingForeignValuationAssets,
            missing_ownership_assets: assetMetrics.missingOwnershipAssets,
            missing_foreign_country_assets: assetMetrics.missingForeignCountryAssets,
            missing_foreign_block_assets: assetMetrics.missingForeignBlockAssets,
            missing_foreign_q4_assets: assetMetrics.missingForeignQ4BalanceAssets,
            threshold_reached_blocks: assetMetrics.thresholdReachedBlocks.length,
            sales_pending: pendingSales,
            exports: exports.length
          },
          canonical_runtime_mode: "derived",
          canonical_approval_status: workflow.canonical_approval_status,
          requirements: {
            model714: model714Requirement,
            model720: model720Requirement
          }
        });

        return {
          id: expediente.id,
          reference: expediente.reference,
          title: expediente.title,
          status: expediente.status,
          fiscal_year: expediente.fiscal_year,
          model_type: expediente.model_type,
          export_model: modelPreparationExportModel(expediente.model_type),
          client: client
            ? {
                id: client.id,
                reference: client.reference,
                display_name: client.display_name,
                nif: client.nif,
                fiscal_unit_label: fiscalUnitState.label,
                fiscal_unit_detail: fiscalUnitState.detail
              }
            : null,
          counts: {
            documents: documents.length,
            pending_review: pendingReview,
            open_alerts: alerts.length,
            exports: exports.length,
            operations: operations.length,
            assets: assetMetrics.totalAssets,
            foreign_assets: assetMetrics.foreignAssets,
            missing_asset_values: assetMetrics.missingValuationAssets,
            missing_foreign_values: assetMetrics.missingForeignValuationAssets,
            missing_ownership_assets: assetMetrics.missingOwnershipAssets,
            missing_foreign_country_assets: assetMetrics.missingForeignCountryAssets,
            missing_foreign_block_assets: assetMetrics.missingForeignBlockAssets,
            missing_foreign_q4_assets: assetMetrics.missingForeignQ4BalanceAssets,
            threshold_reached_blocks: assetMetrics.thresholdReachedBlocks.length,
            sales_pending: pendingSales
          },
          workflow: {
            documental_status: workflow.documental_status,
            revision_status: workflow.revision_status,
            canonical_status: workflow.canonical_status,
            declarative_status: workflow.declarative_status,
            filing_status: workflow.filing_status,
            canonical_approval_status: workflow.canonical_approval_status,
            workflow_owner_ref: workflow.workflow_owner_ref,
            workflow_owner_name: workflow.workflow_owner_name,
            pending_task: workflow.pending_task,
            pending_reason: workflow.pending_reason
          },
          preparation,
          next_action: {
            label: preparation.next_label,
            href: nextActionHref({
              nextTarget: preparation.next_target,
              clientReference: client?.reference ?? null,
              expedienteReference: expediente.reference
            })
          },
          latest_export: exports[0]
            ? {
                model: exports[0].model,
                status: exports[0].status,
                validation_state: exports[0].validation_state,
                generated_at: exports[0].generated_at ?? exports[0].created_at
              }
            : null,
          last_activity_at: latestTimestamp(
            expediente.updated_at,
            ...documents.map((document) => document.updated_at ?? document.created_at),
            ...alerts.map((alert) => alert.created_at),
            ...exports.map((item) => item.generated_at ?? item.created_at)
          )
        };
      })
      .sort((left, right) => {
        const byReadiness = comparePreparationStatus(left.preparation.status, right.preparation.status);
        if (byReadiness !== 0) {
          return byReadiness;
        }

        if (right.preparation.blockers !== left.preparation.blockers) {
          return right.preparation.blockers - left.preparation.blockers;
        }

        if (right.preparation.warnings !== left.preparation.warnings) {
          return right.preparation.warnings - left.preparation.warnings;
        }

        return new Date(right.last_activity_at ?? 0).getTime() - new Date(left.last_activity_at ?? 0).getTime();
      });

    const overview: ModelWorkspaceOverview[] = (["IRPF", "IP", "720"] as const).map((modelType) => {
      const items = workItems.filter((item) => item.model_type === modelType);
      return {
        model_type: modelType,
        export_model: modelPreparationExportModel(modelType),
        expedientes: items.length,
        ready: items.filter((item) => item.preparation.status === "ready").length,
        attention: items.filter((item) => item.preparation.status === "attention").length,
        blocked: items.filter((item) => item.preparation.status === "blocked").length,
        exports: items.reduce((sum, item) => sum + item.counts.exports, 0)
      };
    });

    return NextResponse.json({
      current_user: currentUser,
      summary: {
        expedientes: workItems.length,
        ready: workItems.filter((item) => item.preparation.status === "ready").length,
        attention: workItems.filter((item) => item.preparation.status === "attention").length,
        blocked: workItems.filter((item) => item.preparation.status === "blocked").length,
        exports: workItems.reduce((sum, item) => sum + item.counts.exports, 0)
      },
      overview,
      work_items: workItems
    } satisfies ModelWorkspacePayload);
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo cargar el workspace de modelos") },
      { status: accessErrorStatus(error) }
    );
  }
}

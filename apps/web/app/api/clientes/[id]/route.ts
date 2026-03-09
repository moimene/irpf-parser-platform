import { NextResponse } from "next/server";
import { z } from "zod";
import { listAccessProfiles, listClientAssignments } from "@/lib/access-store";
import { accessErrorMessage, accessErrorStatus, assertClientAccess, getCurrentSessionUser } from "@/lib/auth";
import { loadPersistedCanonicalClientView } from "@/lib/canonical-store";
import { findClientCompat, updateClientFiscalUnitCompat } from "@/lib/client-store";
import { dbTables } from "@/lib/db-tables";
import { deriveCanonicalAssetViews } from "@/lib/fiscal-canonical";
import { summarizeSalesFromOperations, type PersistedSaleAllocationRow, type RuntimeOperationRow } from "@/lib/lots";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type ExpedienteRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  fiscal_year: number;
  model_type: string;
  updated_at: string;
};

type DocumentRow = {
  id: string;
  expediente_id: string;
  filename: string;
  source_type: string;
  processing_status: string;
  manual_review_required: boolean;
  uploaded_at: string | null;
  processed_at: string | null;
  updated_at: string | null;
  created_at: string;
};

type ExtractionRow = {
  id: string;
  document_id: string;
  confidence: number | string | null;
  review_status: string;
  normalized_payload: Record<string, unknown> | null;
  created_at: string;
};

type ExportRow = {
  expediente_id: string;
  model: "100" | "714" | "720";
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
  confidence: number | string | null;
  manual_notes: string | null;
  created_at: string;
};

type LotRow = {
  id: string;
  expediente_id: string;
  acquisition_operation_id: string | null;
  isin: string;
  description: string | null;
  acquisition_date: string;
  quantity_open: number | string;
  total_cost: number | string | null;
  currency: string | null;
  status: "OPEN" | "CLOSED";
  source: string;
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

const updateClientSchema = z.object({
  fiscal_unit: z.object({
    primary_taxpayer_name: z.string().min(2).max(120),
    primary_taxpayer_nif: z.string().min(5).max(20),
    spouse_name: z.string().max(120).optional().or(z.literal("")),
    spouse_nif: z.string().max(20).optional().or(z.literal("")),
    filing_scope: z.enum(["individual", "joint", "pending"]),
    declarant_condition: z.enum(["titular", "cotitular", "no_titular", "pending"]),
    spouse_condition: z.enum(["sin_conyuge", "titular", "cotitular", "no_titular", "pending"]),
    fiscal_link_type: z.enum([
      "sin_conyuge",
      "gananciales",
      "separacion_bienes",
      "pareja_hecho",
      "otro",
      "pending"
    ]),
    notes: z.string().max(2000).optional().or(z.literal(""))
  })
});

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) {
    return null;
  }

  return [...valid].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

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

function countRecords(payload: Record<string, unknown> | null | undefined): number {
  const candidate = payload?.records;
  return Array.isArray(candidate) ? candidate.length : 0;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const client = await findClientCompat(supabase, params.id);
    if (!client) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    await assertClientAccess(supabase, sessionUser, client.id, "clients.read");

    const { data: expedientesData, error: expedientesError } = await supabase
      .from(dbTables.expedientes)
      .select("id, reference, title, status, fiscal_year, model_type, updated_at")
      .eq("client_id", client.id)
      .order("fiscal_year", { ascending: false })
      .order("model_type", { ascending: true });

    if (expedientesError) {
      return NextResponse.json(
        { error: `No se pudieron cargar expedientes del cliente: ${expedientesError.message}` },
        { status: 500 }
      );
    }

    const expedientes = (expedientesData ?? []) as ExpedienteRow[];
    const expedienteIds = expedientes.map((expediente) => expediente.id);

    const documentsResult =
      expedienteIds.length === 0
        ? { data: [] as DocumentRow[], error: null }
        : await supabase
            .from(dbTables.documents)
            .select(
              "id, expediente_id, filename, source_type, processing_status, manual_review_required, uploaded_at, processed_at, updated_at, created_at"
            )
            .in("expediente_id", expedienteIds);

    if (documentsResult.error) {
      return NextResponse.json(
        { error: `No se pudieron cargar documentos del cliente: ${documentsResult.error.message}` },
        { status: 500 }
      );
    }

    const exportsResult =
      expedienteIds.length === 0
        ? { data: [] as ExportRow[], error: null }
        : await supabase
            .from(dbTables.exports)
            .select("expediente_id, model, generated_at, created_at")
            .in("expediente_id", expedienteIds);

    const documentIds = ((documentsResult.data ?? []) as DocumentRow[]).map((document) => document.id);
    const extractionsResult =
      documentIds.length === 0
        ? { data: [] as ExtractionRow[], error: null }
        : await supabase
            .from(dbTables.extractions)
            .select("id, document_id, confidence, review_status, normalized_payload, created_at")
            .in("document_id", documentIds)
            .order("created_at", { ascending: false });

    const operationsResult =
      expedienteIds.length === 0
        ? { data: [] as OperationRow[], error: null }
        : await supabase
            .from(dbTables.operations)
            .select(
              "id, expediente_id, operation_type, operation_date, isin, description, amount, currency, quantity, retention, realized_gain, source, confidence, manual_notes, created_at"
            )
            .in("expediente_id", expedienteIds)
            .order("operation_date", { ascending: false })
            .order("created_at", { ascending: false });

    const lotsResult =
      expedienteIds.length === 0
        ? { data: [] as LotRow[], error: null }
        : await supabase
            .from(dbTables.lots)
            .select("id, expediente_id, acquisition_operation_id, isin, description, acquisition_date, quantity_open, total_cost, currency, status, source")
            .in("expediente_id", expedienteIds)
            .order("acquisition_date", { ascending: false })
            .order("id", { ascending: false });

    const allocationsResult =
      expedienteIds.length === 0
        ? { data: [] as AllocationRow[], error: null }
        : await supabase
            .from(dbTables.saleAllocations)
            .select("sale_operation_id, quantity, sale_amount_allocated, total_cost, realized_gain, acquisition_date, acquisition_operation_id, currency")
            .in("expediente_id", expedienteIds)
            .order("sale_date", { ascending: false })
            .order("acquisition_date", { ascending: false });

    if (
      exportsResult.error ||
      extractionsResult.error ||
      operationsResult.error ||
      lotsResult.error ||
      allocationsResult.error
    ) {
      return NextResponse.json(
        {
          error:
            exportsResult.error?.message ??
            extractionsResult.error?.message ??
            operationsResult.error?.message ??
            lotsResult.error?.message ??
            allocationsResult.error?.message ??
            "No se pudo cargar la base patrimonial del cliente"
        },
        { status: 500 }
      );
    }

    const [assignments, profiles] = await Promise.all([
      listClientAssignments(supabase),
      listAccessProfiles(supabase)
    ]);
    const clientAssignments = assignments.filter((assignment) => assignment.client_id === client.id);
    const usersById = new Map(profiles.map((profile) => [profile.id, profile]));

    const documentsByExpediente = new Map<string, DocumentRow[]>();
    for (const document of documentsResult.data ?? []) {
      const items = documentsByExpediente.get(document.expediente_id) ?? [];
      items.push(document);
      documentsByExpediente.set(document.expediente_id, items);
    }

    const exportsByExpediente = new Map<string, ExportRow[]>();
    for (const exportRow of exportsResult.data ?? []) {
      const items = exportsByExpediente.get(exportRow.expediente_id) ?? [];
      items.push(exportRow);
      exportsByExpediente.set(exportRow.expediente_id, items);
    }

    const latestExtractionByDocument = new Map<string, ExtractionRow>();
    for (const extraction of extractionsResult.data ?? []) {
      if (!latestExtractionByDocument.has(extraction.document_id)) {
        latestExtractionByDocument.set(extraction.document_id, extraction as ExtractionRow);
      }
    }

    const expedienteMetaById = new Map(
      expedientes.map((expediente) => [
        expediente.id,
        {
          reference: expediente.reference,
          fiscal_year: expediente.fiscal_year,
          model_type: expediente.model_type
        }
      ])
    );

    const canonicalOperations = ((operationsResult.data ?? []) as OperationRow[]).map((row) => ({
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
    }));

    const saleSummaries = summarizeSalesFromOperations({
      operations: ((operationsResult.data ?? []) as OperationRow[]).map((row) => ({
        ...row
      })) as RuntimeOperationRow[],
      allocations: ((allocationsResult.data ?? []) as AllocationRow[]).map((row) => ({
        ...row
      })) as PersistedSaleAllocationRow[]
    }).map((summary) => ({
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
    }));

    const derivedCanonicalViews = deriveCanonicalAssetViews({
      operations: canonicalOperations,
      lots: ((lotsResult.data ?? []) as LotRow[]).map((row) => ({
        id: row.id,
        expediente_id: row.expediente_id,
        isin: row.isin,
        description: row.description,
        quantity_open: toNullableNumber(row.quantity_open) ?? 0,
        total_cost: toNullableNumber(row.total_cost),
        currency: row.currency,
        status: row.status
      })),
      saleSummaries,
      expedienteMetaById
    });

    const persistedCanonicalViews = await loadPersistedCanonicalClientView(supabase, {
      clientId: client.id,
      eventLimit: 24
    });

    const shouldFallbackToDerived =
      persistedCanonicalViews === null ||
      (
        persistedCanonicalViews.assets.length === 0 &&
        persistedCanonicalViews.fiscalEvents.length === 0 &&
        (canonicalOperations.length > 0 || ((lotsResult.data ?? []) as LotRow[]).length > 0 || saleSummaries.length > 0)
      );

    const canonicalViews = shouldFallbackToDerived ? derivedCanonicalViews : persistedCanonicalViews;

    const formattedExpedientes = expedientes.map((expediente) => {
      const documents = documentsByExpediente.get(expediente.id) ?? [];
      const exports = exportsByExpediente.get(expediente.id) ?? [];

      return {
        id: expediente.id,
        reference: expediente.reference,
        title: expediente.title,
        status: expediente.status,
        fiscal_year: expediente.fiscal_year,
        model_type: expediente.model_type,
        counts: {
          documents: documents.length,
          pending_review: documents.filter((document) => document.processing_status === "manual_review").length,
          completed: documents.filter((document) => document.processing_status === "completed").length,
          exports: exports.length
        },
        latest_export_model: exports[0]?.model ?? null,
        last_activity_at: latestTimestamp(
          expediente.updated_at,
          ...documents.map((document) => document.updated_at ?? document.created_at),
          ...exports.map((item) => item.generated_at ?? item.created_at)
        )
      };
    });

    const formattedDocuments = ((documentsResult.data ?? []) as DocumentRow[])
      .map((document) => {
        const expediente = expedienteMetaById.get(document.expediente_id);
        const latestExtraction = latestExtractionByDocument.get(document.id) ?? null;

        return {
          id: document.id,
          filename: document.filename,
          source_type: document.source_type,
          processing_status: document.processing_status,
          manual_review_required: document.manual_review_required,
          uploaded_at: document.uploaded_at,
          processed_at: document.processed_at,
          created_at: document.created_at,
          updated_at: document.updated_at ?? document.created_at,
          expediente_id: document.expediente_id,
          expediente_reference: expediente?.reference ?? document.expediente_id,
          expediente_fiscal_year: expediente?.fiscal_year ?? null,
          expediente_model_type: expediente?.model_type ?? null,
          latest_extraction: latestExtraction
            ? {
                id: latestExtraction.id,
                confidence: toNullableNumber(latestExtraction.confidence) ?? 0,
                review_status: latestExtraction.review_status,
                records_count: countRecords(latestExtraction.normalized_payload),
                created_at: latestExtraction.created_at
              }
            : null
        };
      })
      .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());

    return NextResponse.json({
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      },
      client,
      stats: {
        expedientes: formattedExpedientes.length,
        documents: formattedExpedientes.reduce((sum, expediente) => sum + expediente.counts.documents, 0),
        pending_review: formattedExpedientes.reduce((sum, expediente) => sum + expediente.counts.pending_review, 0),
        exports: formattedExpedientes.reduce((sum, expediente) => sum + expediente.counts.exports, 0),
        assets: canonicalViews.assets.length,
        fiscal_events: canonicalViews.fiscalEvents.length,
        last_activity_at: latestTimestamp(
          client.updated_at,
          ...formattedExpedientes.map((expediente) => expediente.last_activity_at)
        )
      },
      assignments: clientAssignments
        .map((assignment) => {
          const user = usersById.get(assignment.user_id);
          if (!user) return null;

          return {
            id: assignment.id,
            assignment_role: assignment.assignment_role,
            created_at: assignment.created_at,
            user: {
              id: user.id,
              reference: user.reference,
              display_name: user.display_name,
              email: user.email,
              role: user.role,
              status: user.status
            }
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
      expedientes: formattedExpedientes,
      client_documents: formattedDocuments,
      client_assets: canonicalViews.assets,
      client_fiscal_events: canonicalViews.fiscalEvents.slice(0, 24)
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo cargar el cliente") },
      { status: accessErrorStatus(error) }
    );
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const client = await findClientCompat(supabase, params.id);
    if (!client) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    await assertClientAccess(supabase, sessionUser, client.id, "clients.fiscal_unit.write");

    const body = await request.json().catch(() => null);
    const parsed = updateClientSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload invalido para unidad fiscal", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updatedClient = await updateClientFiscalUnitCompat(supabase, client.id, {
      primary_taxpayer_name: parsed.data.fiscal_unit.primary_taxpayer_name.trim(),
      primary_taxpayer_nif: parsed.data.fiscal_unit.primary_taxpayer_nif.trim().toUpperCase(),
      spouse_name: parsed.data.fiscal_unit.spouse_name?.trim() || null,
      spouse_nif: parsed.data.fiscal_unit.spouse_nif?.trim().toUpperCase() || null,
      filing_scope: parsed.data.fiscal_unit.filing_scope,
      declarant_condition: parsed.data.fiscal_unit.declarant_condition,
      spouse_condition: parsed.data.fiscal_unit.spouse_condition,
      fiscal_link_type: parsed.data.fiscal_unit.fiscal_link_type,
      notes: parsed.data.fiscal_unit.notes?.trim() || null
    });

    return NextResponse.json({ client: updatedClient });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo actualizar la unidad fiscal") },
      { status: accessErrorStatus(error) }
    );
  }
}

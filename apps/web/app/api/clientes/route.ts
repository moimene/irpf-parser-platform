import { NextResponse } from "next/server";
import { z } from "zod";
import { accessErrorMessage, accessErrorStatus, getCurrentSessionUser, listAccessibleClientIds, requirePermission } from "@/lib/auth";
import { createClientCompat, listClientsCompat } from "@/lib/client-store";
import { dbTables } from "@/lib/db-tables";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type ExpedienteRow = {
  id: string;
  client_id: string | null;
  reference: string;
  model_type: string;
  status: string;
  fiscal_year: number;
  updated_at: string;
};

type DocumentRow = {
  expediente_id: string;
  processing_status: string;
  updated_at: string | null;
  created_at: string;
};

type ExportRow = {
  expediente_id: string;
  generated_at: string | null;
  created_at: string;
};

const createClientSchema = z.object({
  reference: z.string().min(2).max(80).optional(),
  display_name: z.string().min(2).max(120),
  nif: z.string().min(5).max(20),
  email: z.string().email().optional().or(z.literal("")),
  contact_person: z.string().max(120).optional(),
  notes: z.string().max(2000).optional()
});

function toIsoTimestamp(value: string | null | undefined): string | null {
  return value && value.trim() ? value : null;
}

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) {
    return null;
  }

  return [...valid].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "clients.read");
    const accessibleClientIds = await listAccessibleClientIds(supabase, sessionUser);

    if (sessionUser.role !== "admin" && accessibleClientIds.length === 0) {
      return NextResponse.json({ clients: [] });
    }

    const allClients = await listClientsCompat(supabase);
    const clients =
      sessionUser.role === "admin"
        ? allClients
        : allClients.filter((client) => accessibleClientIds.includes(client.id));
    const clientIds = clients.map((client) => client.id);

    const expedientesResult =
      clientIds.length === 0
        ? { data: [] as ExpedienteRow[], error: null }
        : await supabase
            .from(dbTables.expedientes)
            .select("id, client_id, reference, model_type, status, fiscal_year, updated_at")
            .in("client_id", clientIds);

    if (expedientesResult.error) {
      return NextResponse.json(
        { error: `No se pudieron cargar expedientes de clientes: ${expedientesResult.error.message}` },
        { status: 500 }
      );
    }

    const expedientes = expedientesResult.data ?? [];
    const expedienteIds = expedientes.map((expediente) => expediente.id);

    const documentsResult =
      expedienteIds.length === 0
        ? { data: [] as DocumentRow[], error: null }
        : await supabase
            .from(dbTables.documents)
            .select("expediente_id, processing_status, updated_at, created_at")
            .in("expediente_id", expedienteIds);

    if (documentsResult.error) {
      return NextResponse.json(
        { error: `No se pudieron cargar documentos de clientes: ${documentsResult.error.message}` },
        { status: 500 }
      );
    }

    const exportsResult =
      expedienteIds.length === 0
        ? { data: [] as ExportRow[], error: null }
        : await supabase
            .from(dbTables.exports)
            .select("expediente_id, generated_at, created_at")
            .in("expediente_id", expedienteIds);

    if (exportsResult.error) {
      return NextResponse.json(
        { error: `No se pudieron cargar exportaciones de clientes: ${exportsResult.error.message}` },
        { status: 500 }
      );
    }

    const expedientesByClient = new Map<string, ExpedienteRow[]>();
    for (const expediente of expedientes) {
      if (!expediente.client_id) continue;
      const items = expedientesByClient.get(expediente.client_id) ?? [];
      items.push(expediente);
      expedientesByClient.set(expediente.client_id, items);
    }

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

    return NextResponse.json({
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      },
      clients: clients.map((client) => {
        const clientExpedientes = expedientesByClient.get(client.id) ?? [];
        const documents = clientExpedientes.flatMap((expediente) => documentsByExpediente.get(expediente.id) ?? []);
        const exports = clientExpedientes.flatMap((expediente) => exportsByExpediente.get(expediente.id) ?? []);

        const lastActivityAt = latestTimestamp(
          client.updated_at,
          ...clientExpedientes.map((expediente) => expediente.updated_at),
          ...documents.map((document) => toIsoTimestamp(document.updated_at) ?? document.created_at),
          ...exports.map((item) => item.generated_at ?? item.created_at)
        );

        return {
          id: client.id,
          reference: client.reference,
          display_name: client.display_name,
          nif: client.nif,
          email: client.email,
          status: client.status,
          contact_person: client.contact_person,
          notes: client.notes,
          stats: {
            expedientes: clientExpedientes.length,
            documents: documents.length,
            pending_review: documents.filter((document) => document.processing_status === "manual_review").length,
            exports: exports.length
          },
          models: [...new Set(clientExpedientes.map((expediente) => expediente.model_type))],
          last_activity_at: lastActivityAt,
          created_at: client.created_at
        };
      })
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo cargar clientes") },
      { status: accessErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "clients.write");

    const body = await request.json().catch(() => null);
    const parsed = createClientSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para cliente", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const client = await createClientCompat(supabase, {
      reference: parsed.data.reference,
      display_name: parsed.data.display_name.trim(),
      nif: parsed.data.nif.trim().toUpperCase(),
      email: parsed.data.email?.trim() || null,
      contact_person: parsed.data.contact_person?.trim() || null,
      notes: parsed.data.notes?.trim() || null
    });

    return NextResponse.json(
      {
        client: {
          id: client.id,
          reference: client.reference,
          display_name: client.display_name,
          nif: client.nif,
          email: client.email,
          status: client.status,
          contact_person: client.contact_person,
          notes: client.notes,
          created_at: client.created_at
        }
      },
      { status: 201 }
    );
  } catch (error) {
    const message = accessErrorMessage(error, "No se pudo crear el cliente");
    const isConflict = /duplicate|unique/i.test(message);
    return NextResponse.json(
      { error: isConflict ? "Ya existe un cliente con la misma referencia o NIF." : message },
      { status: isConflict ? 409 : accessErrorStatus(error) }
    );
  }
}

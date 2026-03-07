import { NextResponse } from "next/server";
import { listAccessProfiles, listClientAssignments } from "@/lib/access-store";
import { accessErrorMessage, accessErrorStatus, assertClientAccess, getCurrentSessionUser } from "@/lib/auth";
import { findClientCompat } from "@/lib/client-store";
import { dbTables } from "@/lib/db-tables";
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
  expediente_id: string;
  processing_status: string;
  updated_at: string | null;
  created_at: string;
};

type ExportRow = {
  expediente_id: string;
  model: "100" | "714" | "720";
  generated_at: string | null;
  created_at: string;
};

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) {
    return null;
  }

  return [...valid].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
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
            .select("expediente_id, processing_status, updated_at, created_at")
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

    if (exportsResult.error) {
      return NextResponse.json(
        { error: `No se pudieron cargar exportaciones del cliente: ${exportsResult.error.message}` },
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
      expedientes: formattedExpedientes
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo cargar el cliente") },
      { status: accessErrorStatus(error) }
    );
  }
}

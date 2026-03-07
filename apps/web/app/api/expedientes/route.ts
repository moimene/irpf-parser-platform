import { NextResponse } from "next/server";
import { z } from "zod";
import { accessErrorMessage, accessErrorStatus, assertClientAccess, getCurrentSessionUser } from "@/lib/auth";
import { findClientCompat } from "@/lib/client-store";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const createExpedienteSchema = z.object({
  client_id: z.string().min(2),
  reference: z.string().min(3).max(120).optional(),
  title: z.string().min(3).max(160).optional(),
  fiscal_year: z.number().int().min(2013).max(2035),
  model_type: z.enum(["IRPF", "IP", "720"])
});

function modelReference(modelType: "IRPF" | "IP" | "720"): string {
  if (modelType === "IRPF") {
    return "irpf";
  }

  if (modelType === "IP") {
    return "ip";
  }

  return "720";
}

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);

    const body = await request.json().catch(() => null);
    const parsed = createExpedienteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para expediente", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const client = await findClientCompat(supabase, parsed.data.client_id);
    if (!client) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    await assertClientAccess(supabase, sessionUser, client.id, "expedientes.write");

    const expedienteReference =
      parsed.data.reference?.trim() ||
      `${client.reference}-${modelReference(parsed.data.model_type)}-${parsed.data.fiscal_year}`;
    const resolvedExpediente = normalizeExpedienteId(expedienteReference);
    const title =
      parsed.data.title?.trim() ||
      `Expediente ${parsed.data.model_type} ${parsed.data.fiscal_year} - ${client.display_name}`;

    const { data, error } = await supabase
      .from(dbTables.expedientes)
      .upsert(
        {
          id: resolvedExpediente.id,
          reference: resolvedExpediente.reference,
          client_id: client.id,
          fiscal_year: parsed.data.fiscal_year,
          model_type: parsed.data.model_type,
          title,
          status: "BORRADOR"
        },
        { onConflict: "id" }
      )
      .select("id, reference, client_id, fiscal_year, model_type, title, status, created_at, updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: `No se pudo crear el expediente: ${error?.message ?? "unknown"}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        expediente: {
          id: data.id,
          reference: data.reference,
          client_id: data.client_id,
          fiscal_year: data.fiscal_year,
          model_type: data.model_type,
          title: data.title,
          status: data.status
        }
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo crear el expediente") },
      { status: accessErrorStatus(error) }
    );
  }
}

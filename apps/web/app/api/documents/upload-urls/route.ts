import { NextResponse } from "next/server";
import { z } from "zod";
import {
  accessErrorMessage,
  accessErrorStatus,
  assertClientAccess,
  getCurrentSessionUser,
  requirePermission
} from "@/lib/auth";
import { dbTables } from "@/lib/db-tables";
import { isUuid, normalizeExpedienteId } from "@/lib/expediente-id";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

const uploadUrlSchema = z.object({
  expediente_id: z.string().min(3),
  client_id: z.string().optional(),
  files: z
    .array(
      z.object({
        client_id: z.string().min(1),
        filename: z.string().min(1).max(240),
        content_type: z.string().optional(),
        size_bytes: z.number().int().positive().max(MAX_FILE_BYTES)
      })
    )
    .min(1)
    .max(20)
});

function sanitizeFilename(filename: string): string {
  const normalized = filename.normalize("NFKD");
  const safe = normalized.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return safe.slice(0, 120) || "document.pdf";
}

async function ensureStorageBucket(): Promise<null | string> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return "Supabase no configurado";
  }

  const { error } = await supabase.storage.createBucket(env.supabaseStorageBucket, {
    public: false,
    fileSizeLimit: `${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB`
  });

  if (!error) {
    return null;
  }

  const isAlreadyCreated = /already exists|duplicate|exists/i.test(error.message ?? "");
  if (isAlreadyCreated) {
    return null;
  }

  return `No se pudo preparar bucket ${env.supabaseStorageBucket}: ${error.message}`;
}

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = uploadUrlSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Payload inválido para URLs de subida",
          details: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "documents.intake");

    const resolvedExpediente = normalizeExpedienteId(parsed.data.expediente_id);
    const requestedClientId =
      parsed.data.client_id && isUuid(parsed.data.client_id) ? parsed.data.client_id : null;

    if (parsed.data.client_id && !requestedClientId) {
      return NextResponse.json({ error: "Cliente inválido para la preparación de subida." }, { status: 400 });
    }

    const { data: expediente, error: expedienteError } = await supabase
      .from(dbTables.expedientes)
      .select("id, client_id")
      .eq("id", resolvedExpediente.id)
      .maybeSingle();

    if (expedienteError) {
      return NextResponse.json(
        { error: `No se pudo validar el expediente: ${expedienteError.message}` },
        { status: 500 }
      );
    }

    if (!expediente) {
      return NextResponse.json(
        { error: "El expediente no existe. Debes crearlo desde la ficha de cliente antes de subir documentos." },
        { status: 404 }
      );
    }

    if (!expediente.client_id) {
      return NextResponse.json(
        { error: "El expediente no está vinculado a un cliente. Corrige la ficha antes de subir documentos." },
        { status: 409 }
      );
    }

    await assertClientAccess(supabase, sessionUser, expediente.client_id, "documents.intake");

    if (requestedClientId && expediente.client_id !== requestedClientId) {
      return NextResponse.json(
        { error: "La subida solo puede realizarse sobre el cliente ya vinculado al expediente." },
        { status: 409 }
      );
    }

    const bucketError = await ensureStorageBucket();
    if (bucketError) {
      return NextResponse.json({ error: bucketError }, { status: 500 });
    }

    const now = Date.now();
    const uploads = await Promise.all(
      parsed.data.files.map(async (file, index) => {
        const safeFilename = sanitizeFilename(file.filename);
        const storagePath = `${resolvedExpediente.id}/${now}-${index + 1}-${safeFilename}`;

        const { data, error } = await supabase.storage
          .from(env.supabaseStorageBucket)
          .createSignedUploadUrl(storagePath, { upsert: false });

        if (error || !data) {
          throw new Error(
            `No se pudo generar URL de subida para ${file.filename}: ${error?.message ?? "unknown"}`
          );
        }

        return {
          client_id: file.client_id,
          filename: file.filename,
          storage_path: storagePath,
          signed_url: data.signedUrl
        };
      })
    );

    return NextResponse.json({
      bucket: env.supabaseStorageBucket,
      expediente_id: resolvedExpediente.id,
      expediente_reference: resolvedExpediente.reference,
      client_id: expediente.client_id,
      uploads
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudieron preparar las subidas") },
      { status: accessErrorStatus(error) }
    );
  }
}

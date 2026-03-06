import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, getAbogadoActual } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

// GET /api/expedientes/[id] — Detalle de un expediente con sus documentos
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createSupabaseServerClient();
  const abogado = await getAbogadoActual(supabase);
  if (!abogado) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: expediente, error } = await supabase
    .from("irpf_expedientes")
    .select(`
      id, reference, fiscal_year, status, title, client_id, created_at, updated_at,
      irpf_documents (
        id, filename, processing_status, entity, detected_template,
        confidence, manual_review_required, storage_path, created_at
      )
    `)
    .eq("id", params.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ expediente });
}

// PATCH /api/expedientes/[id] — Actualizar estado del expediente
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createSupabaseServerClient();
  const abogado = await getAbogadoActual(supabase);
  if (!abogado) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const { status } = body;

  const { data, error } = await supabase
    .from("irpf_expedientes")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expediente: data });
}

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, getAbogadoActual } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

// GET /api/clientes/[id] — Detalle de un cliente con expedientes y estadísticas
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createSupabaseServerClient();
  const abogado = await getAbogadoActual(supabase);
  if (!abogado) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: client, error } = await supabase
    .from("irpf_clients")
    .select(`
      *,
      irpf_expedientes (
        id, ejercicio, estado, created_at,
        irpf_documents (id, filename, status, entity_type, created_at)
      ),
      irpf_asignaciones (
        abogado_id,
        irpf_abogados (id, nombre, email, rol)
      )
    `)
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // Estadísticas de patrimonio
  const { count: numPatrimonio } = await supabase
    .from("irpf_patrimonio")
    .select("*", { count: "exact", head: true })
    .eq("client_id", params.id);

  const { data: hojas } = await supabase
    .from("irpf_hojas")
    .select("categoria_id, nombre, ejercicio, num_filas, kpis")
    .eq("client_id", params.id)
    .order("categoria_id");

  return NextResponse.json({
    client,
    patrimonio: {
      num_registros: numPatrimonio ?? 0,
      hojas: hojas ?? [],
    },
  });
}

// PATCH /api/clientes/[id] — Actualizar datos del cliente
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createSupabaseServerClient();
  const abogado = await getAbogadoActual(supabase);
  if (!abogado) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (abogado.rol === "paralegal") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await req.json();
  const { full_name, nif, email, phone, notes } = body;

  const { data, error } = await supabase
    .from("irpf_clients")
    .update({ full_name, nif, email, phone, notes, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data });
}

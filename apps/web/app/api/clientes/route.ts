import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, getAbogadoActual } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

// GET /api/clientes — Lista todos los clientes accesibles por el abogado autenticado
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const abogado = await getAbogadoActual(supabase);
  if (!abogado) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";

  // RLS filtra automáticamente según el rol del abogado
  let query = supabase
    .from("irpf_clients")
    .select(`
      id, full_name, nif, email, phone, notes, created_at,
      irpf_expedientes (id, ejercicio, estado)
    `)
    .order("full_name");

  if (q) {
    query = query.or(`full_name.ilike.%${q}%,nif.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enriquecer con estadísticas básicas
  const clients = (data ?? []).map((c: any) => ({
    ...c,
    num_expedientes: c.irpf_expedientes?.length ?? 0,
    ejercicios: [...new Set((c.irpf_expedientes ?? []).map((e: any) => e.ejercicio).filter(Boolean))].sort().reverse(),
  }));

  return NextResponse.json({ clients });
}

// POST /api/clientes — Crear nuevo cliente (solo socios y asociados)
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const abogado = await getAbogadoActual(supabase);
  if (!abogado) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (abogado.rol === "paralegal") {
    return NextResponse.json({ error: "Sin permisos para crear clientes" }, { status: 403 });
  }

  const body = await req.json();
  const { full_name, nif, email, phone, notes } = body;

  if (!full_name || !nif) {
    return NextResponse.json({ error: "full_name y nif son obligatorios" }, { status: 400 });
  }

  const { data: client, error } = await supabase
    .from("irpf_clients")
    .insert({ full_name, nif, email, phone, notes })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe un cliente con ese NIF" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Si no es socio, crear asignación automática al abogado creador
  if (abogado.rol !== "socio") {
    await supabase.from("irpf_asignaciones").insert({
      abogado_id: abogado.id,
      client_id: client.id,
    });
  }

  // Registrar en audit log
  await supabase.from("irpf_audit_log").insert({
    expediente_id: null,
    accion: "cliente.creado",
    actor: abogado.email,
    detalles: { client_id: client.id, nif, full_name },
  });

  return NextResponse.json({ client }, { status: 201 });
}

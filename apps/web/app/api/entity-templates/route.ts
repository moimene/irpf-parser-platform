import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, getAbogadoActual } from "@/lib/supabase-auth-legacy-server";

export const dynamic = "force-dynamic";

// GET /api/entity-templates — Lista todas las plantillas de entidades bancarias
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const abogado  = await getAbogadoActual(supabase);
  if (!abogado) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data, error } = await supabase
    .from("irpf_entity_templates")
    .select("*")
    .order("nombre");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

// POST /api/entity-templates — Crear nueva plantilla (solo socios)
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const abogado  = await getAbogadoActual(supabase);
  if (!abogado) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (abogado.rol !== "socio") {
    return NextResponse.json({ error: "Solo los socios pueden crear plantillas" }, { status: 403 });
  }

  const body = await req.json();
  const { nombre, codigo, keywords, field_mappings, nivel, activa, notas } = body;

  if (!nombre || !codigo) {
    return NextResponse.json({ error: "nombre y codigo son obligatorios" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("irpf_entity_templates")
    .insert({
      nombre,
      codigo:         codigo.toUpperCase(),
      keywords:       keywords ?? [],
      field_mappings: field_mappings ?? {},
      nivel:          nivel ?? 1,
      activa:         activa ?? true,
      notas,
      creado_por:     abogado.email,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe una plantilla con ese codigo" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("irpf_audit_log").insert({
    expediente_id: null,
    accion: "entity_template.creada",
    actor: abogado.email,
    detalles: { template_id: data.id, codigo, nombre },
  });

  return NextResponse.json({ template: data }, { status: 201 });
}

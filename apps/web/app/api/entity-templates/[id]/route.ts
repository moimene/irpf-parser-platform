import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, getAbogadoActual } from "@/lib/supabase-auth-legacy-server";

export const dynamic = "force-dynamic";

// PATCH /api/entity-templates/[id] — Actualizar plantilla
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createSupabaseServerClient();
  const abogado  = await getAbogadoActual(supabase);
  if (!abogado) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (abogado.rol !== "socio") {
    return NextResponse.json({ error: "Solo los socios pueden modificar plantillas" }, { status: 403 });
  }

  const body = await req.json();
  const { nombre, keywords, field_mappings, nivel, activa, notas } = body;

  const { data, error } = await supabase
    .from("irpf_entity_templates")
    .update({ nombre, keywords, field_mappings, nivel, activa, notas, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

// DELETE /api/entity-templates/[id] — Desactivar plantilla (soft delete)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createSupabaseServerClient();
  const abogado  = await getAbogadoActual(supabase);
  if (!abogado) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (abogado.rol !== "socio") {
    return NextResponse.json({ error: "Solo los socios pueden desactivar plantillas" }, { status: 403 });
  }

  const { error } = await supabase
    .from("irpf_entity_templates")
    .update({ activa: false, updated_at: new Date().toISOString() })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

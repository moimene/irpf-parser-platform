import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, getAbogadoActual } from "@/lib/supabase-auth-legacy-server";

export const dynamic = "force-dynamic";

// GET /api/patrimonio?client_id=&categoria_id=&hoja=&page=&limit=&q=
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const abogado = await getAbogadoActual(supabase);
  if (!abogado) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const client_id    = searchParams.get("client_id") ?? "";
  const categoria_id = searchParams.get("categoria_id") ?? "";
  const hoja         = searchParams.get("hoja") ?? "";
  const page         = parseInt(searchParams.get("page") ?? "1");
  const limit        = Math.min(parseInt(searchParams.get("limit") ?? "200"), 500);
  const q            = searchParams.get("q") ?? "";
  const offset       = (page - 1) * limit;

  if (!client_id) {
    return NextResponse.json({ error: "client_id es obligatorio" }, { status: 400 });
  }

  let query = supabase
    .from("irpf_patrimonio")
    .select("id, hoja, ejercicio, fila, datos, fuente, created_at", { count: "exact" })
    .eq("client_id", client_id)
    .order("hoja")
    .order("fila")
    .range(offset, offset + limit - 1);

  if (categoria_id) query = query.eq("categoria_id", categoria_id);
  if (hoja)         query = query.eq("hoja", hoja);
  if (q)            query = query.textSearch("datos", q, { type: "websearch" });

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    rows:       data ?? [],
    total:      count ?? 0,
    page,
    limit,
    pages:      Math.ceil((count ?? 0) / limit),
  });
}

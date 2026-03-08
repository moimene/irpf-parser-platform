import { NextResponse } from "next/server";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import {
  loadCanonicalCatalogs,
  loadCanonicalReviewDrafts,
  upsertDeclarationProfile
} from "@/lib/canonical-registry-manual";
import { declarationProfileInputSchema } from "@/lib/canonical-registry-schemas";
import { loadCanonicalRegistrySnapshot } from "@/lib/asset-registry-store";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const resolvedExpediente = normalizeExpedienteId(params.id);
    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "expedientes.read");

    const [snapshot, catalogs] = await Promise.all([
      loadCanonicalRegistrySnapshot(supabase, resolvedExpediente.id),
      loadCanonicalCatalogs(supabase)
    ]);

    if (!snapshot.available || !catalogs) {
      return NextResponse.json({
        available: false,
        declaration_profile: null,
        assets: [],
        fiscal_events: [],
        catalogs: null,
        draft_assets: [],
        draft_fiscal_events: []
      });
    }

    const drafts = await loadCanonicalReviewDrafts(supabase, resolvedExpediente.id);

    return NextResponse.json({
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      },
      available: true,
      declaration_profile: snapshot.declarationProfile,
      assets: snapshot.assets,
      fiscal_events: snapshot.fiscalEvents,
      catalogs,
      draft_assets: drafts.assetDrafts,
      draft_fiscal_events: drafts.fiscalEventDrafts
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo cargar el workspace canónico") },
      { status: accessErrorStatus(error) }
    );
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const resolvedExpediente = normalizeExpedienteId(params.id);
    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "expedientes.write");

    const body = await request.json().catch(() => null);
    const parsed = declarationProfileInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para perfil declarativo", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await upsertDeclarationProfile(supabase, {
      expedienteId: resolvedExpediente.id,
      actor: sessionUser.reference,
      profile: parsed.data
    });

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: resolvedExpediente.id,
      user_id: sessionUser.reference,
      action: "canonical.profile.updated",
      entity_type: "declaration_profile",
      entity_id: result.after.id,
      before_data: result.before,
      after_data: result.after
    });

    return NextResponse.json({ declaration_profile: result.after });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo actualizar el perfil declarativo") },
      { status: accessErrorStatus(error) }
    );
  }
}

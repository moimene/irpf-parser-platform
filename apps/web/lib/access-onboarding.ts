import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AccessProfile } from "@/lib/access-store";

export type AccessOnboardingState =
  | "no_auth_user"
  | "pending_onboarding"
  | "ready_no_login"
  | "active";

export type AccessLinkMode = "onboarding" | "recovery";
export type AccessLinkDelivery = "invite" | "recovery";

export type AccessAuthStatus = {
  auth_user_id: string | null;
  invited_at: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  recovery_sent_at: string | null;
  onboarding_state: AccessOnboardingState;
};

export type GeneratedAccessLink = {
  auth_user_id: string;
  url: string;
  requested_mode: AccessLinkMode;
  delivery: AccessLinkDelivery;
  created_auth_user: boolean;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildOnboardingRedirectUrl(request: Request): string {
  const redirectUrl = new URL("/onboarding", request.url);

  if (redirectUrl.hostname === "localhost") {
    redirectUrl.hostname = "127.0.0.1";
  }

  return redirectUrl.toString();
}

async function findAuthUserById(
  supabase: SupabaseClient,
  authUserId: string | null | undefined
): Promise<User | null> {
  if (!authUserId) {
    return null;
  }

  const { data, error } = await supabase.auth.admin.getUserById(authUserId);

  if (error) {
    if (error.status === 404 || /not found/i.test(error.message)) {
      return null;
    }

    throw error;
  }

  return data.user ?? null;
}

function summarizeAuthUser(authUser: User | null, fallbackAuthUserId: string | null): AccessAuthStatus {
  if (!authUser) {
    return {
      auth_user_id: fallbackAuthUserId,
      invited_at: null,
      email_confirmed_at: null,
      last_sign_in_at: null,
      recovery_sent_at: null,
      onboarding_state: "no_auth_user"
    };
  }

  let onboardingState: AccessOnboardingState = "pending_onboarding";

  if (authUser.last_sign_in_at) {
    onboardingState = "active";
  } else if (authUser.email_confirmed_at) {
    onboardingState = "ready_no_login";
  }

  return {
    auth_user_id: authUser.id,
    invited_at: authUser.invited_at ?? null,
    email_confirmed_at: authUser.email_confirmed_at ?? null,
    last_sign_in_at: authUser.last_sign_in_at ?? null,
    recovery_sent_at: authUser.recovery_sent_at ?? null,
    onboarding_state: onboardingState
  };
}

export async function listAccessAuthStatusMap(
  supabase: SupabaseClient,
  profiles: AccessProfile[]
): Promise<Map<string, AccessAuthStatus>> {
  const resolvedProfiles = await Promise.all(
    profiles.map(async (profile) => {
      const authUser = await findAuthUserById(supabase, profile.auth_user_id);
      return [profile.id, summarizeAuthUser(authUser, profile.auth_user_id)] as const;
    })
  );

  return new Map(resolvedProfiles);
}

export async function generateAccessUserLink(
  supabase: SupabaseClient,
  input: {
    email: string;
    display_name: string;
    redirectTo: string;
    mode: AccessLinkMode;
    auth_user_id?: string | null;
  }
): Promise<GeneratedAccessLink> {
  const normalizedEmail = normalizeEmail(input.email);
  const existingAuthUser = await findAuthUserById(supabase, input.auth_user_id);
  const shouldBootstrapInvite = input.mode === "onboarding" && !existingAuthUser;
  const shouldFallbackToInvite = input.mode === "recovery" && !existingAuthUser;
  const delivery: AccessLinkDelivery =
    shouldBootstrapInvite || shouldFallbackToInvite ? "invite" : "recovery";

  const { data, error } = await supabase.auth.admin.generateLink(
    delivery === "invite"
      ? {
          type: "invite",
          email: normalizedEmail,
          options: {
            data: {
              display_name: input.display_name.trim()
            },
            redirectTo: input.redirectTo
          }
        }
      : {
          type: "recovery",
          email: normalizedEmail,
          options: {
            redirectTo: input.redirectTo
          }
        }
  );

  if (error || !data.user || !data.properties.action_link) {
    throw new Error(error?.message ?? "No se pudo generar el enlace seguro de acceso.");
  }

  return {
    auth_user_id: data.user.id,
    url: data.properties.action_link,
    requested_mode: input.mode,
    delivery,
    created_auth_user: Boolean(!existingAuthUser && delivery === "invite")
  };
}

/**
 * Sign in with an existing login system (IMP-099).
 *
 * A self-hosted Memoria can let people sign in through any standard OpenID
 * Connect login system (Authentik, Keycloak, Authelia, Zitadel, ...). It is
 * off unless OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are all set.
 * The secret stays on the server; the browser only learns the button label.
 */

import type { PrismaClient } from "@/generated/prisma/client";

/** Better Auth provider id; the callback is `/api/auth/callback/oidc`. */
export const SSO_PROVIDER_ID = "oidc";
export const SSO_SIGN_IN_PATH = "/sign-in/social";
export const SSO_CALLBACK_PATH = `/callback/${SSO_PROVIDER_ID}`;
export const DEFAULT_SSO_LABEL = "single sign-on";

export interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  label: string;
}

interface SsoEnv {
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_BUTTON_LABEL?: string;
}

/** The configured login system, or null when single sign-on is off. */
export function ssoConfigFromEnv(source: SsoEnv): SsoConfig | null {
  const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET } = source;
  if (!OIDC_ISSUER || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) return null;
  return {
    issuer: OIDC_ISSUER.replace(/\/+$/, ""),
    clientId: OIDC_CLIENT_ID,
    clientSecret: OIDC_CLIENT_SECRET,
    label: source.OIDC_BUTTON_LABEL?.trim() || DEFAULT_SSO_LABEL,
  };
}

/** Where the login system publishes its endpoints and signing keys. */
export function discoveryUrl(issuer: string) {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

/**
 * The login system's answers, as Better Auth reports them on
 * `?error=<code>` when it sends the person back to the sign-in page.
 */
export function ssoErrorMessage(code: string | null | undefined) {
  if (!code) return null;
  switch (code) {
    case "signup_disabled":
      return "There is no Memoria account for this login yet. Ask the owner of this Memoria for an invite.";
    case "account_not_linked":
    case "unable_to_link_account":
    case "email_does_not_match":
    case "account_already_linked_to_different_user":
      return "An account with this email already exists. Sign in with your password once your login system confirms the email address, or ask the owner for help.";
    case "email_not_verified":
    case "email_not_found":
      return "Your login system did not confirm your email address, so Memoria cannot sign you in with it.";
    case "access_denied":
      return "Sign-in was cancelled.";
    default:
      return "Signing in with your login system did not work. Try again, or sign in with your password.";
  }
}

/**
 * Every account gets the same starting place as a registered one: a
 * "Personal" workspace holding an "Inbox" canvas. Safe to run twice.
 */
export async function ensureStarterResources(
  prisma: Pick<PrismaClient, "$transaction">,
  userId: string,
) {
  await prisma.$transaction(async (tx) => {
    // Serialize concurrent first sign-ins for the same person.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`starter:${userId}`}))`;
    const existing = await tx.workspace.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (existing) return;
    const workspace = await tx.workspace.create({
      data: { name: "Personal", userId },
      select: { id: true },
    });
    await tx.canvas.create({
      data: { name: "Inbox", userId, workspaceId: workspace.id },
    });
  });
}

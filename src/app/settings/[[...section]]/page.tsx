import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCredentialPasswordHash } from "@/lib/auth/credentials";
import { passkeysEnabled } from "@/lib/auth/server";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsContent } from "../SettingsContent";
import { settingsSectionFromSegments } from "../sections";
import { iosShortcutUrl, memoriaAddress } from "@/lib/guides/phone-sharing";
import { isInstanceOwner } from "@/lib/auth/registration-invites";

interface SettingsPageProps {
  params: Promise<{ section?: string[] }>;
}

export async function generateMetadata({ params }: SettingsPageProps) {
  const section = settingsSectionFromSegments((await params).section);
  return {
    title: section ? `${section.label} · Settings` : "Settings",
    description: "Manage your account settings",
  };
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const section = settingsSectionFromSegments((await params).section);
  if (!section) notFound();

  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login");
  }

  // IMP-153: Invites is the owner's alone; for anyone else it does not exist.
  const isOwner = await isInstanceOwner(prisma, session.user.id);
  if ("ownerOnly" in section && section.ownerOnly && !isOwner) notFound();

  // IMP-099: someone who only signs in with a login system has no password.
  const hasPassword = Boolean(
    await getCredentialPasswordHash(prisma, session.user.id),
  );

  return (
    <AppShell>
      <SettingsContent
        user={{ ...session.user, hasPassword }}
        section={section.id}
        passkeys={passkeysEnabled()}
        isOwner={isOwner}
        apiKeys={
          section.id === "api-keys"
            ? { serverAddress: memoriaAddress(), shortcutUrl: iosShortcutUrl() }
            : undefined
        }
      />
    </AppShell>
  );
}

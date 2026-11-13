import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCredentialPasswordHash } from "@/lib/auth/credentials";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsContent } from "../SettingsContent";
import { settingsSectionFromSegments } from "../sections";

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

  // IMP-099: someone who only signs in with a login system has no password.
  const hasPassword = Boolean(
    await getCredentialPasswordHash(prisma, session.user.id),
  );

  return (
    <AppShell>
      <SettingsContent
        user={{ ...session.user, hasPassword }}
        section={section.id}
      />
    </AppShell>
  );
}

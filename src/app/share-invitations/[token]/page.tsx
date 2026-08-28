import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { InvitationResponseContent } from "./InvitationResponseContent";

export const metadata = {
  title: "Canvas invitation",
  description: "Review a Memoria canvas invitation",
};

export default async function ShareInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user) {
    const callbackUrl = `/share-invitations/${token}`;
    redirect(`/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  return (
    <AppShell maxWidth="sm">
      <InvitationResponseContent token={token} />
    </AppShell>
  );
}

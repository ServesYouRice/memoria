import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { NotificationsContent } from "./NotificationsContent";

export const metadata = {
  title: "Notifications",
  description: "Canvas invitations and responses",
};

export default async function NotificationsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login");
  }

  return (
    <AppShell maxWidth="md">
      <NotificationsContent />
    </AppShell>
  );
}

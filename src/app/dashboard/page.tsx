import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardContent } from "@/features/dashboard/components/DashboardContent";
import { DashboardSkeleton } from "@/features/dashboard/components/DashboardSkeleton";

export const metadata = {
  title: "Dashboard",
  description: "Your Memoria dashboard",
};

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login");
  }

  return (
    <AppShell>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent userName={session.user.name} />
      </Suspense>
    </AppShell>
  );
}

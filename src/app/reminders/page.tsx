import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { RemindersContent } from "./RemindersContent";

export const metadata = {
  title: "Reminders",
  description: "Items you asked Memoria to bring back",
};

export default async function RemindersPage() {
  if (!(await auth())?.user) redirect("/auth/login");
  return (
    <AppShell readingWidth="md">
      <RemindersContent />
    </AppShell>
  );
}

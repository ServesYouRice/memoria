import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { TemplatesContent } from "./TemplatesContent";

export const metadata = {
  title: "Templates",
  description: "Start a canvas from a ready-made layout",
};

export default async function TemplatesPage() {
  if (!(await auth())?.user) redirect("/auth/login");
  return (
    <AppShell>
      <TemplatesContent />
    </AppShell>
  );
}

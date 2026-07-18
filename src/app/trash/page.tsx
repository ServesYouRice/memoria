import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { TrashContent } from "./TrashContent";

export const metadata = {
  title: "Trash",
  description: "Restore deleted canvas items",
};

export default async function TrashPage() {
  if (!(await auth())?.user) redirect("/auth/login");
  return (
    <AppShell>
      <TrashContent />
    </AppShell>
  );
}

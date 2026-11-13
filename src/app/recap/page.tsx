import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { RecapContent } from "./RecapContent";

export const metadata = {
  title: "Weekly recap",
  description: "What you saved this week and old links to tidy up",
};

export default async function RecapPage() {
  if (!(await auth())?.user) redirect("/auth/login");
  return (
    <AppShell readingWidth="md">
      <RecapContent />
    </AppShell>
  );
}

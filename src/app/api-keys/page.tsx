import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { ApiKeysContent } from "./ApiKeysContent";
import { iosShortcutUrl, memoriaAddress } from "@/lib/guides/phone-sharing";

export const metadata = {
  title: "API Keys",
  description: "Manage API keys for external access and extensions",
};

export default async function ApiKeysPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login");
  }

  return (
    <AppShell readingWidth="md">
      <ApiKeysContent
        serverAddress={memoriaAddress()}
        shortcutUrl={iosShortcutUrl()}
      />
    </AppShell>
  );
}

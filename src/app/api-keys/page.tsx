import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const metadata = {
  title: "API keys",
  description: "Manage API keys for external access and extensions",
};

/** API keys live in Settings (IMP-127); the old address still works. */
export default async function ApiKeysPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login");
  }

  redirect("/settings/api-keys");
}

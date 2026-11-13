import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { INBOX_CANVAS_NAME } from "@/lib/agents/inbox";

/** Opens the signed-in user's Inbox canvas, or the dashboard if they have none. */
export default async function InboxPage() {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/auth/login");

  const inbox = await prisma.canvas.findFirst({
    where: { userId, name: INBOX_CANVAS_NAME },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  redirect(inbox ? `/canvas/${inbox.id}` : "/dashboard");
}

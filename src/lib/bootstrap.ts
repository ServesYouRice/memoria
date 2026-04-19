import { prisma } from "@/lib/db";

export async function isBootstrapAvailable() {
  const userCount = await prisma.user.count();
  return userCount === 0;
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const metadata = {
  title: "Templates",
  description: "Start a canvas from a ready-made layout",
};

/** Templates open from "New canvas" on the dashboard (IMP-126). */
export default async function TemplatesPage() {
  if (!(await auth())?.user) redirect("/auth/login");
  redirect("/dashboard?new=1");
}

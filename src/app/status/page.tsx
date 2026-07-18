import type { Metadata } from "next";
import { PublicInfoPage } from "@/components/layout/PublicInfoPage";
import { StatusSummary } from "@/components/StatusSummary";

export const metadata: Metadata = {
  title: "Status",
  description: "Live readiness status for this Memoria installation.",
};

export default function StatusPage() {
  return (
    <PublicInfoPage
      title="Service status"
      description="Live checks report service readiness without exposing credentials or connection details."
    >
      <StatusSummary />
    </PublicInfoPage>
  );
}

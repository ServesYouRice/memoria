import type { Metadata } from "next";
import { PublicInfoPage } from "@/components/layout/PublicInfoPage";
import { StatusSummary } from "@/components/StatusSummary";

export const metadata: Metadata = {
  title: "Status",
  description: "Sanitized service status for this Memoria installation.",
};

export default function StatusPage() {
  return (
    <PublicInfoPage
      title="Service status"
      description="A public summary reports availability without exposing dependency names, credentials, or connection details."
    >
      <StatusSummary />
    </PublicInfoPage>
  );
}

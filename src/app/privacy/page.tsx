import type { Metadata } from "next";
import {
  InfoSection,
  PublicInfoPage,
} from "@/components/layout/PublicInfoPage";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Memoria stores and processes account and canvas data.",
};

export default function PrivacyPage() {
  return (
    <PublicInfoPage
      title="Privacy"
      description="This notice describes the data handled by this Memoria installation."
    >
      <InfoSection title="Data you provide">
        Account details, canvas content, comments, sharing settings, uploaded
        files, API credentials, and optional model-provider credentials are
        stored to provide the service.
      </InfoSection>
      <InfoSection title="Operational data">
        The service records bounded security and diagnostic events such as
        request identifiers, timestamps, endpoint paths, and rate-limit
        activity. Passwords, recovery URLs, raw search queries, and secret
        values are not intentionally written to application logs.
      </InfoSection>
      <InfoSection title="Sharing and integrations">
        Content is disclosed to collaborators or public-link visitors only when
        you enable those features. Data sent to AI providers or outbound
        integrations is governed by the provider and configuration selected by
        the installation owner.
      </InfoSection>
      <InfoSection title="Retention and control">
        You can edit or delete content, download a portable account export, and
        delete your account in Settings. Soft-deleted canvas items may remain
        until the installation&apos;s retention cleanup runs. For a self-hosted
        installation, contact its operator for backup and retention details.
      </InfoSection>
    </PublicInfoPage>
  );
}

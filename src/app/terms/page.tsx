import type { Metadata } from "next";
import {
  InfoSection,
  PublicInfoPage,
} from "@/components/layout/PublicInfoPage";

export const metadata: Metadata = {
  title: "Terms",
  description: "Basic terms for using a Memoria installation.",
};

export default function TermsPage() {
  return (
    <PublicInfoPage
      title="Terms of use"
      description="These baseline terms apply unless the operator of this installation publishes replacement terms."
    >
      <InfoSection title="Acceptable use">
        Do not use Memoria to violate law, infringe rights, distribute malware,
        probe systems without permission, or interfere with other users or the
        service.
      </InfoSection>
      <InfoSection title="Your content">
        You retain responsibility for content you add and for people with whom
        you share it. You must have the rights and permissions needed to store
        and process that content.
      </InfoSection>
      <InfoSection title="Service operation">
        Features may change and the service may be interrupted for maintenance
        or security reasons. Self-hosted operators are responsible for
        infrastructure, backups, email delivery, integrations, and local legal
        requirements.
      </InfoSection>
      <InfoSection title="Security">
        Keep passwords, API keys, bootstrap tokens, and integration credentials
        confidential. Report suspected compromise to the operator and revoke
        affected credentials promptly.
      </InfoSection>
    </PublicInfoPage>
  );
}

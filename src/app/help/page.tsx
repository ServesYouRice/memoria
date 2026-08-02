import type { Metadata } from "next";
import {
  InfoSection,
  PublicInfoPage,
} from "@/components/layout/PublicInfoPage";

export const metadata: Metadata = {
  title: "Help",
  description:
    "Help for canvases, collaboration, recovery, and keyboard access.",
};

export default function HelpPage() {
  return (
    <PublicInfoPage
      title="Help"
      description="Quick guidance for the workflows built into Memoria."
    >
      <InfoSection title="Canvas navigation">
        Hold Space and drag to pan, use the wheel or trackpad to zoom, and
        switch to Organizer view for a keyboard- and screen-reader-friendly item
        list. Press ? inside the application to open the current
        keyboard-shortcut reference.
      </InfoSection>
      <InfoSection title="Sharing roles">
        Viewers can read, commenters can participate in comments, editors can
        change items, and owners manage sharing, versions, templates,
        thumbnails, and deletion.
      </InfoSection>
      <InfoSection title="Embeds, timer, and AR">
        Embedded links are shown as previews: Memoria displays where the link
        points and opens it in a new tab, and never loads or runs third-party
        content inside the canvas. The meeting timer is personal — it runs in
        your own browser only and is not shared with collaborators or restored
        after a reload. The augmented-reality layer is experimental, is off
        unless the operator of this installation enables it, and its camera feed
        stays on your device.
      </InfoSection>
      <InfoSection title="Recovery">
        Use version history to restore a canvas snapshot. Password recovery
        requires a configured production email provider. Account and credential
        controls are available in Settings.
      </InfoSection>
      <InfoSection title="Troubleshooting">
        Retry a failed canvas load from its error banner. Check the Status page
        for database, cache, and process readiness. If the problem persists,
        contact the operator of this installation with the request identifier
        shown in the response.
      </InfoSection>
    </PublicInfoPage>
  );
}

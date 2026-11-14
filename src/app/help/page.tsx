import type { Metadata } from "next";
import { Button, Typography } from "@mui/material";
import { GuideContent } from "@/components/GuideContent";
import { phoneSharingGuide } from "@/lib/guides/phone-sharing";
import {
  InfoSection,
  PublicInfoPage,
} from "@/components/layout/PublicInfoPage";
import { ALWAYS_FREE, MEMORIA_LICENCE_NAME } from "@/lib/licence/promise";

export const metadata: Metadata = {
  title: "Help",
  description:
    "Help for canvases, collaboration, recovery, and keyboard access.",
};

export default async function HelpPage() {
  const phone = await phoneSharingGuide();
  return (
    <PublicInfoPage
      title="Help"
      description="Quick guidance for the workflows built into Memoria."
    >
      <InfoSection title="Canvas navigation">
        Hold Space and drag to pan, use the wheel or trackpad to zoom, and
        switch to Organised list for a keyboard- and screen-reader-friendly item
        list. Press ? inside the application to open the current
        keyboard-shortcut reference.
      </InfoSection>
      <InfoSection title="Sharing roles">
        <ul>
          <li>Viewers can read a canvas and look at earlier versions.</li>
          <li>Commenters can also add comments.</li>
          <li>Editors can also change items, and save or restore versions.</li>
          <li>Owners can also manage sharing and delete the canvas.</li>
        </ul>
        Memoria saves an automatic snapshot of a canvas you are editing at most
        every ten minutes, and thins out old automatic snapshots over time;
        versions you save yourself are kept.
      </InfoSection>
      <InfoSection title="Embeds, timer, and AR">
        Embedded links are shown as previews: Memoria displays where the link
        points and opens it in a new tab, and never loads or runs third-party
        content inside the canvas. The meeting timer is shared — everyone on the
        canvas sees the same countdown, only editors start or stop it, and it
        ends when the last person leaves. The augmented-reality layer is
        experimental, is off unless the operator of this installation enables
        it, and its camera feed stays on your device.
      </InfoSection>
      <InfoSection title="Recovery">
        Use version history to restore a canvas snapshot. Resetting a password
        needs email to be set up on this installation. Account and credential
        controls are available in Settings.
      </InfoSection>
      <InfoSection title="Save from your phone">
        Send a link from any app on your phone to your Memoria Inbox. You need
        an API key for the iPhone: create one on the API Keys page with{" "}
        <strong>Create a key for my iPhone</strong>.
        <GuideContent
          sections={phone.sections}
          after={
            phone.shortcutUrl
              ? {
                  title: "1. Create an API key",
                  content: (
                    <>
                      <Typography
                        component="h4"
                        variant="subtitle1"
                        sx={{ fontWeight: 600, color: "text.primary", mt: 2 }}
                      >
                        2. Add the Shortcut
                      </Typography>
                      <Typography component="p" sx={{ my: 1 }}>
                        Tap the button on your iPhone or iPad, then paste the
                        server address and the key when the Shortcut asks.
                      </Typography>
                      <Button
                        variant="contained"
                        href={phone.shortcutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Add the Shortcut
                      </Button>
                    </>
                  ),
                }
              : undefined
          }
        />
      </InfoSection>
      <InfoSection title="Always free">
        Memoria is free software under the {MEMORIA_LICENCE_NAME}. These
        features will always stay free and never be put behind a payment:
        <ul>
          {ALWAYS_FREE.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </InfoSection>
      <InfoSection title="If Memoria ever stops">
        You are not locked in. Export every canvas as PNG, PDF, Markdown or JSON
        at any time, and download a copy of your whole account from Settings.
        Memoria is free software you can run on your own server, so you can keep
        using your own copy whatever happens to this one.
      </InfoSection>
      <InfoSection title="Troubleshooting">
        Retry a failed canvas load from its error banner. Check the Status page
        to see whether Memoria is working. If the problem persists, contact
        whoever runs this installation and give them the request ID shown in the
        error message.
      </InfoSection>
    </PublicInfoPage>
  );
}

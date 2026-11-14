/**
 * IMP-086: Settings is split into groups, each at its own address.
 * `/settings` opens Account. IMP-091 added Import. A group marked
 * `ownerOnly` is shown to the owner of this Memoria alone (IMP-153).
 */
export const SETTINGS_SECTIONS = [
  {
    id: "account",
    path: "/settings",
    label: "Account",
    intro: "Your name and the email address you sign in with.",
  },
  {
    id: "security",
    path: "/settings/security",
    label: "Sign-in and security",
    intro:
      "Change your password, add passkeys or two-step codes, and sign out other devices.",
  },
  {
    id: "appearance",
    path: "/settings/appearance",
    label: "Appearance",
    intro: "Choose light or dark.",
  },
  {
    id: "shortcuts",
    path: "/settings/shortcuts",
    label: "Keyboard shortcuts",
    intro: "The keys that make common actions faster.",
  },
  {
    id: "notifications",
    path: "/settings/notifications",
    label: "Notifications",
    intro:
      "Pick what Memoria tells you about, and when you get your weekly recap.",
  },
  {
    id: "ai",
    path: "/settings/ai",
    label: "AI assistant",
    intro: "Connect your own AI key and choose what AI may do for you.",
  },
  {
    id: "import",
    path: "/settings/import",
    label: "Import",
    intro:
      "Bring your saved links from a browser, Pocket or Raindrop. Links you already have are skipped.",
  },
  {
    id: "api-keys",
    path: "/settings/api-keys",
    label: "API keys",
    intro: "Create keys for browser extensions and webhooks. Keep them secret.",
  },
  {
    // IMP-153: only the owner of this Memoria sees this group.
    id: "invites",
    path: "/settings/invites",
    label: "Invites",
    intro:
      "Invite someone to make their own account here. Only you, as the owner, see this.",
    ownerOnly: true,
  },
  {
    id: "data",
    path: "/settings/data",
    label: "Your data",
    intro: "Download everything you have stored, or delete your account.",
  },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
export type SettingsSectionInfo = (typeof SETTINGS_SECTIONS)[number];

/** The groups this person may open: owner-only ones are left out for others. */
export function visibleSettingsSections(
  isOwner: boolean,
): SettingsSectionInfo[] {
  return SETTINGS_SECTIONS.filter(
    (section) => isOwner || !("ownerOnly" in section && section.ownerOnly),
  );
}

/** The group for a URL segment (`undefined` is Account), or null if unknown. */
export function settingsSectionFromSegments(
  segments: string[] | undefined,
): SettingsSectionInfo | null {
  if (!segments || segments.length === 0) return SETTINGS_SECTIONS[0];
  if (segments.length > 1) return null;
  const [segment] = segments;
  if (segment === "account") return null;
  return SETTINGS_SECTIONS.find((section) => section.id === segment) ?? null;
}

/** Old one-page anchors, so `/settings#notifications` still lands right. */
export const LEGACY_SETTINGS_ANCHORS: Record<string, string> = {
  notifications: "/settings/notifications",
  "weekly-recap": "/settings/notifications#weekly-recap",
  "agent-console": "/settings/ai#agent-console",
};

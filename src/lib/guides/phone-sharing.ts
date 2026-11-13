import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "@/lib/env";
import { parseGuide, replaceInGuide, type GuideSection } from "./markdown";

/** The single source of the phone steps (IMP-092). */
export const PHONE_GUIDE_PATH = join(
  process.cwd(),
  "docs",
  "integrations",
  "phone-sharing.md",
);

/** The address a Shortcut on a phone sends links to. */
export function memoriaAddress(): string {
  return new URL(env.AUTH_URL).origin;
}

/** The ready-made Shortcut for this installation, when the owner set one. */
export function iosShortcutUrl(): string | null {
  return env.IOS_SHORTCUT_URL ?? null;
}

/**
 * The phone guide for people, not developers: the request details are left
 * out, the address placeholder becomes this installation's address, and the
 * hand-built steps make way for the ready-made Shortcut when there is one.
 */
export async function phoneSharingGuide(): Promise<{
  sections: GuideSection[];
  shortcutUrl: string | null;
}> {
  const markdown = await readFile(PHONE_GUIDE_PATH, "utf8");
  const shortcutUrl = iosShortcutUrl();
  const host = new URL(memoriaAddress()).host;
  const sections = replaceInGuide(
    parseGuide(markdown),
    "<your-memoria-address>",
    host,
  ).filter(
    (section) =>
      section.level > 1 &&
      !section.title.startsWith("For developers") &&
      section.title !== "Ready-made Shortcut" &&
      !(shortcutUrl && section.title === "2. Build the Shortcut"),
  );
  return { sections, shortcutUrl };
}

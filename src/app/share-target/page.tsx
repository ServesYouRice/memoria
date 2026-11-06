import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { ShareTargetContent } from "./ShareTargetContent";
import {
  SHARE_ID_PATTERN,
  buildShareTargetHref,
  parseSharedLink,
  readSharedParams,
} from "./shared-link";

export const metadata = {
  title: "Save to Memoria",
  description: "Save a shared link to your Memoria Inbox",
};

/**
 * Landing page of the PWA share target (IMP-062). The manifest sends shares
 * here as a GET, so the shared link survives the sign-in redirect in the
 * callback URL.
 */
export default async function ShareTargetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = readSharedParams(await searchParams);
  const session = await auth();
  if (!session?.user) {
    const callbackUrl = buildShareTargetHref({ ...params, sid: undefined });
    redirect(`/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const link = parseSharedLink(params);
  if (link && !(params.sid && SHARE_ID_PATTERN.test(params.sid))) {
    // Name this share once; reloads keep the id and so replay the save.
    redirect(buildShareTargetHref({ ...params, sid: nanoid(21) }));
  }

  return (
    <AppShell maxWidth="sm">
      <ShareTargetContent
        link={link}
        shareId={params.sid ?? null}
        sharedText={params.text ?? null}
      />
    </AppShell>
  );
}

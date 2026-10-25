import { redirect } from "next/navigation";
import { Alert, Paper, Typography } from "@mui/material";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/layout/AppShell";
import {
  OAuthError,
  createConsentTicket,
  validateAuthorizationRequest,
} from "@/lib/oauth/service";
import { ConsentForm } from "./ConsentForm";

export const metadata = {
  title: "Connect an app",
  description: "Allow an AI app to use your Memoria boards",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function flatten(params: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = flatten(await searchParams);
  const session = await auth();

  if (!session?.user?.id) {
    const query = new URLSearchParams(
      Object.entries(params).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const callbackUrl = `/oauth/authorize?${query.toString()}`;
    redirect(`/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  let validation: Awaited<ReturnType<typeof validateAuthorizationRequest>>;
  try {
    validation = await validateAuthorizationRequest(params);
  } catch (error) {
    if (!(error instanceof OAuthError)) {
      throw error;
    }

    return (
      <AppShell maxWidth="sm">
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
            This connection can&apos;t continue
          </Typography>
          <Alert severity="error">{error.description}</Alert>
        </Paper>
      </AppShell>
    );
  }

  if (!validation.ok) {
    redirect(validation.redirectTo);
  }

  const canvases = await prisma.canvas.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return (
    <AppShell maxWidth="sm">
      <ConsentForm
        ticket={createConsentTicket(validation.request, session.user.id)}
        clientName={validation.request.clientName}
        redirectHost={new URL(validation.request.redirectUri).host}
        canvases={canvases}
      />
    </AppShell>
  );
}

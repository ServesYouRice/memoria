import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const DEFAULT_PASSWORD = "Correct-Horse-Battery-Staple-42!";

interface CapturedMessage {
  id: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  deliveryId: string | null;
  receivedAt: string;
}

export function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.com`;
}

export async function waitForCapturedMessage(
  request: APIRequestContext,
  email: string,
  subject: string,
): Promise<CapturedMessage> {
  const captureUrl = process.env["E2E_EMAIL_CAPTURE_URL"];
  const captureToken = process.env["E2E_EMAIL_CAPTURE_TOKEN"];
  if (!captureUrl || !captureToken) {
    throw new Error("E2E email capture is not configured");
  }

  let message: CapturedMessage | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `${captureUrl}/messages?to=${encodeURIComponent(email)}&subject=${encodeURIComponent(subject)}`,
          { headers: { "x-e2e-token": captureToken } },
        );
        if (!response.ok()) return 0;
        const payload = (await response.json()) as {
          messages?: CapturedMessage[];
        };
        message = payload.messages?.at(-1);
        return payload.messages?.length || 0;
      },
      { timeout: 20_000, intervals: [250, 500, 1000] },
    )
    .toBeGreaterThan(0);

  if (!message) throw new Error(`No captured email for ${email}`);
  return message;
}

export function capturedLink(message: CapturedMessage, pathname: string) {
  const candidates = `${message.text}\n${message.html}`.match(
    /https?:\/\/[^\s"'<>]+/g,
  );
  const link = candidates
    ?.map((candidate) => candidate.replace(/&amp;/g, "&"))
    .find((candidate) => new URL(candidate).pathname.startsWith(pathname));
  if (!link) {
    throw new Error(`Captured email did not contain a ${pathname} link`);
  }
  return link;
}

export async function signIn(
  page: Page,
  email: string,
  password = DEFAULT_PASSWORD,
) {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 15_000 });
}

export async function registerAndVerify(
  page: Page,
  email: string,
  password = DEFAULT_PASSWORD,
) {
  await page.goto("/auth/register");
  await page.getByLabel("Full name").fill("E2E User");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Check your inbox" }),
  ).toBeVisible({ timeout: 15_000 });

  const message = await waitForCapturedMessage(
    page.request,
    email,
    "Verify Your Email",
  );
  const verificationUrl = new URL(capturedLink(message, "/auth/verify-email"));
  await page.goto(`${verificationUrl.pathname}${verificationUrl.search}`);
  await expect(page).toHaveURL(/\/auth\/login\?verified=1/, {
    timeout: 15_000,
  });
  await signIn(page, email, password);
}

export async function createCanvas(page: Page, name: string) {
  const response = await page.request.post("/api/v1/canvases", {
    data: { name },
    headers: { "x-idempotency-key": randomUUID() },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

export function noteContent(text: string) {
  return {
    formatVersion: 1,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
    plainText: text,
    text: `<p>${text}</p>`,
  };
}

export async function createNote(page: Page, canvasId: string, text: string) {
  const response = await page.request.post("/api/v1/canvas-items", {
    data: {
      canvasId,
      type: "NOTE",
      positionX: 120,
      positionY: 120,
      width: 300,
      height: 180,
      zIndex: 1,
      content: noteContent(text),
      tags: ["e2e"],
    },
    headers: { "x-idempotency-key": randomUUID() },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; version: number };
}

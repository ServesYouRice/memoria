import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  createCanvas,
  createNote,
  registerAndVerify,
  uniqueEmail,
} from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("real S3 uploads, exports, and public-link revocation survive production traffic", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = uniqueEmail("durable-canvas");
  await registerAndVerify(page, email);
  const canvas = await createCanvas(page, "Durable E2E Canvas");
  await createNote(page, canvas.id, "Durable production note");

  const uploadResponse = await page.request.post("/api/v1/upload", {
    multipart: {
      canvasId: canvas.id,
      file: { name: "pixel.png", mimeType: "image/png", buffer: PNG },
    },
    headers: { "x-idempotency-key": randomUUID() },
  });
  expect(uploadResponse.status()).toBe(200);
  const upload = (await uploadResponse.json()) as {
    url: string;
    filename: string;
  };
  const privateRead = await page.request.get(upload.url);
  expect(privateRead.status()).toBe(200);
  expect(privateRead.headers()["cache-control"]).toContain("private");

  const anonymousContext = await browser.newContext({ baseURL });
  const anonymousPage = await anonymousContext.newPage();
  expect((await anonymousPage.request.get(upload.url)).status()).toBe(401);

  const imageResponse = await page.request.post("/api/v1/canvas-items", {
    data: {
      canvasId: canvas.id,
      type: "IMAGE",
      positionX: 480,
      positionY: 120,
      width: 160,
      height: 160,
      zIndex: 2,
      content: {
        url: upload.url,
        filename: upload.filename,
        alt: "Private S3 pixel",
        width: 1,
        height: 1,
      },
      tags: ["upload"],
    },
    headers: { "x-idempotency-key": randomUUID() },
  });
  expect(imageResponse.status()).toBe(201);

  const viewportSavePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/canvases/${canvas.id}`) &&
      response.request().method() === "PATCH",
  );
  await page.goto(`/canvas/${canvas.id}`);
  const itemRegion = page.getByRole("region", {
    name: `Items on ${canvas.name}`,
  });
  await expect(itemRegion).toContainText("Durable production note");
  await expect(itemRegion).toContainText("Private S3 pixel");
  expect((await viewportSavePromise).status()).toBe(200);

  await page.getByRole("button", { name: "More canvas options" }).click();
  await page.getByRole("menuitem", { name: "Export Canvas" }).click();
  await page.getByLabel("JSON (Backup)").check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("durable_e2e_canvas.json");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, "utf8")) as {
    canvasId: string;
    name: string;
    items: Array<{ type: string }>;
  };
  expect(exported.canvasId).toBe(canvas.id);
  expect(exported.name).toBe(canvas.name);
  expect(exported.items.map((item) => item.type)).toEqual(
    expect.arrayContaining(["NOTE", "IMAGE"]),
  );

  const publicResponse = await page.request.post(
    `/api/v1/canvases/${canvas.id}/public`,
  );
  expect(publicResponse.status()).toBe(200);
  const firstPublic = (await publicResponse.json()) as { shareUrl: string };
  const firstToken = new URL(firstPublic.shareUrl).pathname.split("/").at(-1);
  expect(firstToken).toBeTruthy();
  expect(
    (await anonymousPage.request.get(`/api/v1/share/${firstToken}`)).status(),
  ).toBe(200);

  await page.getByRole("button", { name: "Share canvas" }).click();
  await expect(
    page.getByRole("textbox", { name: "Public share link" }),
  ).toHaveValue(firstPublic.shareUrl);
  const rotateResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/canvases/${canvas.id}/public`) &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Rotate public link" }).click();
  const rotateDialog = page.getByRole("dialog", {
    name: "Rotate public link?",
  });
  await expect(rotateDialog).toBeVisible();
  await rotateDialog.getByRole("button", { name: "Rotate link" }).click();
  const rotateResponse = await rotateResponsePromise;
  expect(rotateResponse.status()).toBe(200);
  const rotated = (await rotateResponse.json()) as { shareUrl: string };
  expect(rotated.shareUrl).not.toBe(firstPublic.shareUrl);
  const rotatedToken = new URL(rotated.shareUrl).pathname.split("/").at(-1);
  expect(rotatedToken).toBeTruthy();
  expect(
    (await anonymousPage.request.get(`/api/v1/share/${firstToken}`)).status(),
  ).toBe(404);
  expect(
    (await anonymousPage.request.get(`/api/v1/share/${rotatedToken}`)).status(),
  ).toBe(200);

  const disableResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/canvases/${canvas.id}/public`) &&
      response.request().method() === "DELETE",
  );
  await page
    .getByRole("switch", { name: "Anyone with the link can view" })
    .click();
  const disableDialog = page.getByRole("dialog", {
    name: "Disable public link?",
  });
  await expect(disableDialog).toBeVisible();
  await disableDialog.getByRole("button", { name: "Disable link" }).click();
  expect((await disableResponsePromise).status()).toBe(200);
  expect(
    (await anonymousPage.request.get(`/api/v1/share/${rotatedToken}`)).status(),
  ).toBe(404);

  expect((await page.request.delete(upload.url)).status()).toBe(202);
  await expect
    .poll(async () => (await page.request.get(upload.url)).status(), {
      timeout: 20_000,
    })
    .toBe(404);

  await anonymousContext.close();
});

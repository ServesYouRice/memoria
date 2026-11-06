import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  expect,
  test,
  type BrowserContext,
  type Frame,
  type Page,
} from "@playwright/test";
import {
  createCanvas,
  createNote,
  registerAndVerify,
  uniqueEmail,
} from "./helpers";

/**
 * Signed embeds (IMP-044) in a real browser against the production image.
 *
 * Host pages live on other origins. The app only accepts https origins in
 * production, so each host is a fake https origin whose document is served by
 * Playwright route interception; the browser still enforces `frame-ancestors`
 * against that origin exactly as it would for a real site.
 *
 * The framed app is reached through a fake https origin too, whose requests
 * Playwright forwards to the real gateway with the gateway's own headers. An
 * http loopback frame inside an https page is mixed content to WebKit, which
 * blocks it before framing rules apply, and a public page reaching loopback
 * trips Chromium's Local Network Access check.
 */

const ALLOWED_ORIGIN = "https://embed-host-allowed.example";
const OTHER_ORIGIN = "https://embed-host-other.example";
const APP_ORIGIN = "https://memoria-app.example";

/** Serve the real app under APP_ORIGIN for every page in the context. */
async function proxyApp(context: BrowserContext, gatewayOrigin: string) {
  await context.route(`${APP_ORIGIN}/**`, async (route) => {
    const response = await route.fetch({
      url: gatewayOrigin + route.request().url().slice(APP_ORIGIN.length),
    });
    await route.fulfill({ response });
  });
}

function viaProxy(url: string) {
  const parsed = new URL(url);
  return `${APP_ORIGIN}${parsed.pathname}${parsed.search}`;
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** A solid pure-red RGB PNG, so the rendered canvas pixels are unmistakable. */
function solidRedPng(size = 8) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: size }, () => [255, 0, 0]).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function openHostPage(
  context: BrowserContext,
  hostOrigin: string,
  frameSrc: string,
) {
  await context.route(`${hostOrigin}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Host page</title><iframe id="embed" src="${frameSrc}" width="1100" height="640"></iframe>`,
    }),
  );
  const page = await context.newPage();
  const blocked: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url() === frameSrc) {
      blocked.push(request.failure()?.errorText ?? "failed");
    }
  });
  await page.goto(`${hostOrigin}/`);
  await page.waitForLoadState("load");
  return { page, blocked };
}

function childFrame(page: Page): Frame {
  const frame = page
    .frames()
    .find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error("Host page has no child frame");
  return frame;
}

/**
 * The browser refused to show the framed document. Chromium reports a
 * `chrome-error:` frame URL and a blocked request. Firefox leaves the frame
 * without the app URL, and its error frame cannot be queried (a locator waits
 * forever). WebKit keeps the URL but leaves the frame document empty.
 */
async function expectFramingRefused(
  page: Page,
  blocked: string[],
  frameSrc: string,
  browserName: string,
) {
  if (browserName === "chromium") {
    await expect
      .poll(() => childFrame(page).url(), { timeout: 15_000 })
      .toMatch(/^chrome-error:/);
    expect(blocked.join(",")).toContain("ERR_BLOCKED_BY_RESPONSE");
    return;
  }
  // openHostPage waited for the host's load event, which covers the iframe.
  const frame = childFrame(page);
  if (browserName === "firefox") {
    expect(frame.url()).not.toBe(frameSrc);
    return;
  }
  await expect(frame.locator("main, [role=region], form")).toHaveCount(0);
}

/** Distinct X-Frame-Options values (the gateway and app may each send one). */
function frameOptions(headers: Record<string, string>) {
  return [
    ...new Set(
      (headers["x-frame-options"] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

async function countRedCanvasPixels(frame: Frame) {
  return frame.evaluate(() => {
    let red = 0;
    for (const canvas of document.querySelectorAll("canvas")) {
      const context = canvas.getContext("2d");
      if (!context || canvas.width === 0 || canvas.height === 0) continue;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < data.length; index += 4) {
        if (
          data[index]! > 200 &&
          data[index + 1]! < 60 &&
          data[index + 2]! < 60
        ) {
          red += 1;
        }
      }
    }
    return red;
  });
}

test("signed embeds are framed only by their allowed origins and stop at revoke", async ({
  page,
  browser,
  browserName,
  baseURL,
}) => {
  const email = uniqueEmail("embeds");
  await registerAndVerify(page, email);
  const canvas = await createCanvas(page, "Embed E2E Canvas");
  await createNote(page, canvas.id, "Embedded production note");

  // A private image: only the embed token (not a session) lets the viewer
  // read it.
  const uploadResponse = await page.request.post("/api/v1/upload", {
    multipart: {
      canvasId: canvas.id,
      file: { name: "red.png", mimeType: "image/png", buffer: solidRedPng() },
    },
    headers: { "x-idempotency-key": randomUUID() },
  });
  expect(uploadResponse.status()).toBe(200);
  const upload = (await uploadResponse.json()) as {
    url: string;
    filename: string;
  };
  const imageResponse = await page.request.post("/api/v1/canvas-items", {
    data: {
      canvasId: canvas.id,
      type: "IMAGE",
      positionX: 480,
      positionY: 120,
      width: 200,
      height: 200,
      zIndex: 2,
      content: {
        url: upload.url,
        filename: upload.filename,
        alt: "Private red square",
        width: 8,
        height: 8,
      },
      tags: ["embed"],
    },
    headers: { "x-idempotency-key": randomUUID() },
  });
  expect(imageResponse.status()).toBe(201);

  const created = await page.request.post(
    `/api/v1/canvases/${canvas.id}/embeds`,
    {
      data: {
        label: "E2E embed",
        allowedOrigins: [ALLOWED_ORIGIN],
        expiresInDays: 1,
      },
      headers: { "x-idempotency-key": randomUUID() },
    },
  );
  expect(created.status()).toBe(201);
  const { embed, embedUrl } = (await created.json()) as {
    embed: { id: string };
    embedUrl: string;
  };
  expect(new URL(embedUrl).origin).toBe(new URL(baseURL!).origin);

  // Everything below runs without the owner's session cookies.
  const viewerContext = await browser.newContext();
  await proxyApp(viewerContext, new URL(baseURL!).origin);
  const framedEmbedUrl = viaProxy(embedUrl);
  try {
    // Headers on the wire: framing allowed for exactly the listed origin.
    const embedHeaders = (await viewerContext.request.get(embedUrl)).headers();
    expect(embedHeaders["content-security-policy"]).toContain(
      `frame-ancestors ${ALLOWED_ORIGIN};`,
    );
    expect(embedHeaders["x-frame-options"]).toBeUndefined();

    // 1. An allowed origin frames the embed and the canvas renders, including
    //    the private image.
    const imageLoaded = viewerContext.waitForEvent("response", {
      predicate: (response) =>
        /\/api\/v1\/uploads\/[^/?]+\?embed=/.test(response.url()),
    });
    const allowed = await openHostPage(
      viewerContext,
      ALLOWED_ORIGIN,
      framedEmbedUrl,
    );
    const frame = childFrame(allowed.page);
    await expect.poll(() => frame.url()).toBe(framedEmbedUrl);
    expect(allowed.blocked).toEqual([]);
    await expect(
      frame.getByRole("region", { name: /read-only embedded canvas/ }),
    ).toBeVisible();
    await expect(frame.locator("canvas").first()).toBeVisible();
    const image = await imageLoaded;
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
    await expect.poll(() => countRedCanvasPixels(frame)).toBeGreaterThan(100);

    // The same private image URL without the embed token is not readable.
    expect((await viewerContext.request.get(upload.url)).status()).toBe(401);

    // 2. An origin that is not on the allow-list is refused.
    const other = await openHostPage(
      viewerContext,
      OTHER_ORIGIN,
      framedEmbedUrl,
    );
    await expectFramingRefused(
      other.page,
      other.blocked,
      framedEmbedUrl,
      browserName,
    );

    // 4. Non-embed routes cannot be framed, even by the embed's allowed origin.
    const loginUrl = new URL("/auth/login", baseURL!).toString();
    const loginHeaders = (await viewerContext.request.get(loginUrl)).headers();
    expect(frameOptions(loginHeaders)).toEqual(["DENY"]);
    expect(loginHeaders["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    const framedLogin = await openHostPage(
      viewerContext,
      ALLOWED_ORIGIN,
      viaProxy(loginUrl),
    );
    await expectFramingRefused(
      framedLogin.page,
      framedLogin.blocked,
      viaProxy(loginUrl),
      browserName,
    );

    // 3. After revoke the embed stops working immediately.
    const revoked = await page.request.delete(
      `/api/v1/canvases/${canvas.id}/embeds/${embed.id}`,
      { headers: { "x-idempotency-key": randomUUID() } },
    );
    expect(revoked.status()).toBe(200);

    const revokedResponse = await viewerContext.request.get(embedUrl);
    expect(revokedResponse.status()).toBe(404);
    expect(frameOptions(revokedResponse.headers())).toEqual(["DENY"]);
    expect(revokedResponse.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(
      (
        await viewerContext.request.get(
          `${upload.url}?embed=${embedUrl.split("/").pop()}`,
        )
      ).status(),
    ).toBe(401);

    const afterRevoke = await openHostPage(
      viewerContext,
      ALLOWED_ORIGIN,
      framedEmbedUrl,
    );
    await expectFramingRefused(
      afterRevoke.page,
      afterRevoke.blocked,
      framedEmbedUrl,
      browserName,
    );
  } finally {
    await viewerContext.close();
  }
});

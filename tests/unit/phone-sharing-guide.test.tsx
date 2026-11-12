// @vitest-environment happy-dom
/**
 * IMP-092: Help shows the phone steps from docs/integrations/phone-sharing.md
 * (the single source), the API Keys page makes a key for the iPhone with the
 * address beside it, and the share page explains the Shortcut on iOS.
 */
import React from "react";
import { readFileSync } from "node:fs";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  AUTH_URL: "https://memoria.example/app",
  IOS_SHORTCUT_URL: undefined as string | undefined,
}));
vi.mock("@/lib/env", () => ({ env }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

import { GuideContent } from "@/components/GuideContent";
import { parseGuide } from "@/lib/guides/markdown";
import {
  PHONE_GUIDE_PATH,
  memoriaAddress,
  phoneSharingGuide,
} from "@/lib/guides/phone-sharing";
import { ApiKeysContent, PHONE_KEY_NAME } from "@/app/api-keys/ApiKeysContent";
import {
  ShareTargetContent,
  isAppleMobile,
} from "@/app/share-target/ShareTargetContent";

afterEach(() => {
  cleanup();
  env.IOS_SHORTCUT_URL = undefined;
  vi.unstubAllGlobals();
});

describe("guide reader", () => {
  it("reads headings, nested lists, tables and inline marks", () => {
    const [section] = parseGuide(
      "## Steps\n\n1. **Open** it\n   - URL: `x`\n     - deep\n2. Done *now*\n\n| A | B |\n| --- | --- |\n| `1` | two |\n",
    );
    expect(section!.title).toBe("Steps");
    expect(section!.blocks[0]).toMatchObject({
      kind: "list",
      ordered: true,
      items: [
        {
          content: [
            { kind: "bold", text: "Open" },
            { kind: "text", text: " it" },
          ],
          children: { items: [{ children: { items: [{}] } }] },
        },
        { content: [{ text: "Done " }, { kind: "italic", text: "now" }] },
      ],
    });
    expect(section!.blocks[1]).toMatchObject({ kind: "table" });
  });
});

describe("Help: save from your phone", () => {
  it("shows the plain steps from the docs file, with this server's address", async () => {
    const { sections } = await phoneSharingGuide();
    render(<GuideContent sections={sections} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Android");
    expect(text).toContain("Create a key for my iPhone");
    expect(text).toContain("Get Contents of URL");
    expect(text).toContain(
      "https://memoria.example/api/v1/extensions/clip/batch",
    );
    expect(text).not.toContain("<your-memoria-address>");
    // Developer details stay in the repository guide.
    expect(text).not.toContain("idempotencyKey must be");
    expect(text).not.toContain("For developers");
    expect(text).not.toContain("Ready-made Shortcut");
    // Every step shown comes from the docs file.
    const source = readFileSync(PHONE_GUIDE_PATH, "utf8");
    for (const section of sections) expect(source).toContain(section.title);
  });

  it("swaps the hand-built steps for the ready-made Shortcut when one is set", async () => {
    env.IOS_SHORTCUT_URL = "https://www.icloud.com/shortcuts/abc";
    const guide = await phoneSharingGuide();
    expect(guide.shortcutUrl).toBe("https://www.icloud.com/shortcuts/abc");
    expect(guide.sections.map((section) => section.title)).not.toContain(
      "2. Build the Shortcut",
    );
    expect(memoriaAddress()).toBe("https://memoria.example");
  });
});

describe("API Keys: create a key for my iPhone", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(
              JSON.stringify({
                key: { id: "k1", name: PHONE_KEY_NAME },
                plaintextKey: "mem_secret_key",
              }),
              { status: 201, headers: { "Content-Type": "application/json" } },
            )
          : new Response(JSON.stringify({ keys: [] }), {
              headers: { "Content-Type": "application/json" },
            }),
      ),
    );
  });

  it("creates the key and shows the address and key with copy buttons", async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ApiKeysContent
          serverAddress="https://memoria.example"
          shortcutUrl="https://www.icloud.com/shortcuts/abc"
        />
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create a key for my iPhone" }),
    );
    await waitFor(() => expect(screen.getByLabelText("API key")).toBeTruthy());
    const sent = vi
      .mocked(fetch)
      .mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(sent[1]!.body))).toMatchObject({
      name: PHONE_KEY_NAME,
    });
    expect(
      (screen.getByLabelText("Server address") as HTMLInputElement).value,
    ).toBe("https://memoria.example");
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(
      "mem_secret_key",
    );
    expect(
      screen.getByRole("button", { name: "Copy server address" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy api key" })).toBeTruthy();
    const add = screen.getByRole("link", { name: "Add the Shortcut" });
    // The key is never put in a link.
    expect(add.getAttribute("href")).toBe(
      "https://www.icloud.com/shortcuts/abc",
    );
    expect(document.body.innerHTML).not.toMatch(/href="[^"]*mem_secret_key/);
  });
});

describe("share page on an iPhone", () => {
  it("recognises iPhone and iPad", () => {
    expect(isAppleMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", 5)).toBe(
      true,
    );
    expect(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5)).toBe(
      true,
    );
    expect(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 0)).toBe(
      false,
    );
    expect(isAppleMobile("Mozilla/5.0 (Linux; Android 15)", 5)).toBe(false);
  });

  it("explains the Shortcut instead of an empty page", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)",
      maxTouchPoints: 5,
    });
    render(<ShareTargetContent link={null} shareId={null} sharedText={null} />);
    expect(
      await screen.findByRole("heading", {
        name: "Save from your iPhone or iPad",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Show me how" }).getAttribute("href"),
    ).toBe("/help#save-from-your-phone");
  });
});

describe("API Keys: iPhone key after signing in again", () => {
  it("keeps the iPhone name in the dialog when a recent sign-in is needed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(
              JSON.stringify({
                title: "Forbidden",
                detail: "Sign in again to create an API key.",
                code: "recent_sign_in_required",
              }),
              {
                status: 403,
                headers: { "Content-Type": "application/problem+json" },
              },
            )
          : new Response(JSON.stringify({ keys: [] }), {
              headers: { "Content-Type": "application/json" },
            }),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiKeysContent serverAddress="https://memoria.example" />
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create a key for my iPhone" }),
    );
    const name = (await screen.findByLabelText("Key name")) as HTMLInputElement;
    expect(name.value).toBe(PHONE_KEY_NAME);
    expect(screen.getByText(/Sign in again to create/)).toBeTruthy();
  });
});

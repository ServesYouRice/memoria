import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildShareTargetHref,
  extractUrlFromText,
  parseSharedLink,
  readSharedParams,
  shareIdempotencyKey,
} from "@/app/share-target/shared-link";
import { clipBatchSchema } from "@/lib/validation/extension";
import { isShareTargetSaveRequest } from "@/proxy";
import manifest from "../../public/manifest.json";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: unknown }) => children,
}));

import ShareTargetPage from "@/app/share-target/page";

describe("share target manifest", () => {
  it("declares a GET share target with title, text and url", () => {
    expect(manifest.share_target).toEqual({
      action: "/share-target",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    });
  });
});

describe("shared link parsing", () => {
  it("uses the url parameter when it is an http link", () => {
    expect(
      parseSharedLink({ url: "https://example.com/a", title: "A page" }),
    ).toEqual({ url: "https://example.com/a", title: "A page" });
  });

  it("pulls the link out of the text when url is empty", () => {
    expect(
      parseSharedLink({ text: "Look at this https://example.com/b?x=1." }),
    ).toEqual({ url: "https://example.com/b?x=1", title: "Look at this" });
    expect(extractUrlFromText("(see https://example.com/c)")).toBe(
      "https://example.com/c",
    );
  });

  it("prefers the shared title over the remaining text", () => {
    expect(
      parseSharedLink({
        title: "Shared title",
        text: "Some words https://example.com/d",
      }),
    ).toEqual({ url: "https://example.com/d", title: "Shared title" });
  });

  it("ignores non-http links and text without a link", () => {
    expect(parseSharedLink({ url: "javascript:alert(1)" })).toBeNull();
    expect(parseSharedLink({ text: "just a thought" })).toBeNull();
    expect(parseSharedLink({})).toBeNull();
  });

  it("reads the first value of repeated params and trims blanks", () => {
    expect(
      readSharedParams({
        url: ["https://a.example", "x"],
        title: "  ",
        sid: "s",
      }),
    ).toEqual({
      url: "https://a.example",
      title: undefined,
      text: undefined,
      sid: "s",
    });
  });

  it("round-trips the share through the share-target href", () => {
    const href = buildShareTargetHref({
      title: "A & B",
      text: "see https://e.example/?q=1&r=2",
      sid: "abcdefgh12",
    });
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/share-target");
    expect(readSharedParams(Object.fromEntries(url.searchParams))).toEqual({
      title: "A & B",
      text: "see https://e.example/?q=1&r=2",
      url: undefined,
      sid: "abcdefgh12",
    });
  });

  it("derives an idempotency key the clip-batch schema accepts", () => {
    const key = shareIdempotencyKey("V1StGXR8_Z5jdHi6B-myT");
    expect(
      clipBatchSchema.safeParse({
        idempotencyKey: key,
        links: [{ url: "https://example.com" }],
      }).success,
    ).toBe(true);
  });
});

describe("share target proxy budget", () => {
  it("rate limits only the save writes", () => {
    expect(isShareTargetSaveRequest("/share-target/save", "POST")).toBe(true);
    expect(isShareTargetSaveRequest("/share-target/save", "PATCH")).toBe(true);
    expect(isShareTargetSaveRequest("/share-target/save", "GET")).toBe(false);
    expect(isShareTargetSaveRequest("/share-target", "GET")).toBe(false);
  });
});

describe("share target page", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.redirect.mockClear();
  });

  const render = (params: Record<string, string>) =>
    ShareTargetPage({ searchParams: Promise.resolve(params) });

  it("sends a signed-out share through sign-in with the share in the callback", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(
      render({ title: "T", text: "x https://example.com/p", sid: "old" }),
    ).rejects.toThrow(/^REDIRECT:/);

    const target = new URL(
      mocks.redirect.mock.calls[0]![0] as string,
      "http://localhost",
    );
    expect(target.pathname).toBe("/auth/login");
    const callback = new URL(
      target.searchParams.get("callbackUrl")!,
      "http://localhost",
    );
    expect(callback.pathname).toBe("/share-target");
    expect(callback.searchParams.get("title")).toBe("T");
    expect(callback.searchParams.get("text")).toBe("x https://example.com/p");
    expect(callback.searchParams.has("sid")).toBe(false);
  });

  it("names a new share once so a reload replays it", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    await expect(render({ url: "https://example.com/p" })).rejects.toThrow(
      /^REDIRECT:/,
    );
    const target = new URL(
      mocks.redirect.mock.calls[0]![0] as string,
      "http://localhost",
    );
    expect(target.pathname).toBe("/share-target");
    expect(target.searchParams.get("url")).toBe("https://example.com/p");
    expect(target.searchParams.get("sid")).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });

  it("renders the save screen for a named share", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    const page = (await render({
      url: "https://example.com/p",
      sid: "abcdefgh12",
    })) as { props: { children: { props: Record<string, unknown> } } };
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(page.props.children.props).toMatchObject({
      link: { url: "https://example.com/p" },
      shareId: "abcdefgh12",
    });
  });

  it("does not mint a share id when there is no link", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    const page = (await render({ text: "no link here" })) as {
      props: { children: { props: Record<string, unknown> } };
    };
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(page.props.children.props).toMatchObject({
      link: null,
      sharedText: "no link here",
    });
  });
});

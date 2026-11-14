// @vitest-environment happy-dom
/**
 * IMP-153: the owner's Invites group makes a sign-up link, shows it once,
 * and lists invites with a way to cancel unused ones.
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { RegistrationInviteSettings } from "@/app/settings/RegistrationInviteSettings";

const pending = {
  id: "cinvite1",
  email: "pending@example.com",
  createdAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2026-11-08T00:00:00.000Z",
  usedAt: null,
  status: "pending",
};

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

let invites: Array<Record<string, unknown>>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invites = [pending];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method) {
      return json({
        invites,
        registrationMode: "invite",
        mailConfigured: false,
      });
    }
    if (init.method === "POST") {
      const created = {
        ...pending,
        id: "cinvite2",
        email: "new@example.com",
      };
      invites = [created, ...invites];
      return json(
        {
          invite: created,
          inviteUrl:
            "https://memoria.example/auth/register?inviteToken=abc&email=new%40example.com",
          emailQueued: false,
        },
        201,
      );
    }
    invites = invites.filter((invite) => !url.endsWith(String(invite.id)));
    return json({ success: true });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Invites settings", () => {
  it("makes a link and shows it once", async () => {
    render(<RegistrationInviteSettings />);
    expect(await screen.findByText("pending@example.com")).toBeTruthy();
    expect(screen.getByText(/send them the link yourself/)).toBeTruthy();

    const make = screen.getByRole("button", { name: "Make invite link" });
    expect(make.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Enter an email address first.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Their email address"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(make);

    const link = (await screen.findByLabelText(
      "Invite link",
    )) as HTMLInputElement;
    expect(link.value).toContain("inviteToken=abc");
    expect(screen.getByText(/it is not shown again/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/registration-invites",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "new@example.com" }),
      }),
    );
    expect(await screen.findByText("new@example.com")).toBeTruthy();
  });

  it("cancels an unused invite", async () => {
    render(<RegistrationInviteSettings />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Cancel invite for pending@example.com",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("pending@example.com")).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/registration-invites/cinvite1",
      { method: "DELETE" },
    );
    expect(screen.getByText("No invites yet.")).toBeTruthy();
  });
});

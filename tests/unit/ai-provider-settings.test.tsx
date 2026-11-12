// @vitest-environment happy-dom
/**
 * IMP-102 — AI set-up in three plain steps; saving tests the key and says
 * in plain words whether it works.
 */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AiProviderSettings } from "@/app/settings/AiProviderSettings";

const providers = [
  {
    provider: "OPENAI",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    keyPageUrl: "https://platform.openai.com/api-keys",
    requiresBaseUrl: false,
    suggestedModels: ["gpt-5.4-mini"],
  },
  {
    provider: "OPENAI_COMPAT",
    label: "OpenAI-Compatible / Local",
    defaultBaseUrl: null,
    keyPageUrl: null,
    requiresBaseUrl: true,
    suggestedModels: ["custom"],
  },
];

const off = {
  providers,
  current: null,
  availability: {
    configured: false,
    source: null,
    provider: null,
    model: null,
  },
};

const fetchMock = vi.fn();

async function renderSettings() {
  await act(async () => {
    render(<AiProviderSettings />);
  });
}

describe("AI set-up (IMP-102)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says AI is off and shows three steps with the provider's key page", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(off)));
    await renderSettings();

    expect(screen.getByText("AI is off.")).toBeTruthy();
    expect(screen.getByText(/is used for Ask/)).toBeTruthy();
    for (const step of ["1. Pick a provider", "2. Get a key", "3. Paste it"])
      expect(screen.getByText(step)).toBeTruthy();
    const link = screen.getByRole("link", { name: "OpenAI's key page" });
    expect(link.getAttribute("href")).toBe(
      "https://platform.openai.com/api-keys",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // Model and address wait under "More options".
    expect(screen.queryByLabelText("Model")).toBeNull();
  });

  it("tests the key on save and says what is wrong in plain words", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(off)))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...off,
            current: {
              id: "c1",
              provider: "OPENAI",
              model: "gpt-5.4-mini",
              baseUrl: null,
              status: "ERROR",
              hasKey: true,
            },
            check: {
              ok: false,
              problem: "no-credit",
              message: "The key is right, but the account has no credit left.",
            },
          }),
        ),
      );
    await renderSettings();

    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk-test" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
    });

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/v1/ai/provider");
    expect(JSON.parse(init.body)).toMatchObject({
      provider: "OPENAI",
      model: "gpt-5.4-mini",
      apiKey: "sk-test",
    });
    expect(
      screen.getByText("The key is right, but the account has no credit left."),
    ).toBeTruthy();
    // The key field is cleared and never shows the key again.
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("says AI is on and what it uses once a key works", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...off,
          current: {
            id: "c1",
            provider: "OPENAI",
            model: "gpt-5.4-mini",
            baseUrl: null,
            status: "ACTIVE",
            hasKey: true,
          },
          availability: {
            configured: true,
            source: "user",
            provider: "OPENAI",
            model: "gpt-5.4-mini",
          },
        }),
      ),
    );
    await renderSettings();
    expect(screen.getByText("AI is on")).toBeTruthy();
    expect(screen.getByText(/your key/)).toBeTruthy();
  });

  it("asks for the server address for a self-hosted AI server", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(off)));
    await renderSettings();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /Provider/ }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("option", { name: "OpenAI-Compatible / Local" }),
      );
    });
    expect(screen.getByLabelText("Server address")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /key page/ })).toBeNull();
  });
});

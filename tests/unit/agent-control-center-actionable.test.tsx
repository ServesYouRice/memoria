// @vitest-environment happy-dom
/**
 * TASK-129 — the suggestion queue and the rollback list ask the server for
 * actionable records and page through them, so newer resolved records cannot
 * push an older OPEN suggestion or revertable change set out of view.
 */

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/fetch-client", () => ({ apiFetch: apiFetchMock }));

import { AgentControlCenter } from "@/features/agents/components/AgentControlCenter";

const suggestion = (id: string, status: string, summary: string) => ({
  id,
  userId: "u",
  agentProfileId: null,
  kind: "INTERNAL_ORGANIZATION",
  status,
  summary,
  payload: {},
  expiresAt: "2030-01-01T00:00:00.000Z",
  actedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const changeSet = (id: string, status: string, summary: string) => ({
  id,
  userId: "u",
  agentProfileId: "p",
  agentActionId: null,
  scopeType: "canvas",
  scopeId: "c",
  status,
  summary,
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
  revertedAt: status === "REVERTED" ? "2026-01-02T00:00:00.000Z" : null,
  changeRecords: [],
});

// A server with 20 newer resolved records ahead of the actionable ones.
const resolvedSuggestions = Array.from({ length: 20 }, (_, i) =>
  suggestion(`rs${i}`, "EXECUTED", `resolved suggestion ${i}`),
);
const revertedChangeSets = Array.from({ length: 20 }, (_, i) =>
  changeSet(`rc${i}`, "REVERTED", `reverted change ${i}`),
);
let openSuggestions = [
  suggestion("open1", "OPEN", "older open suggestion"),
  suggestion("open2", "APPROVED", "oldest approved suggestion"),
];
const revertable = [changeSet("cs1", "COMPLETED", "older revertable change")];

function timeline(url: URL) {
  const limit = Number(url.searchParams.get("limit"));
  const statuses = url.searchParams.get("suggestionStatus")?.split(",");
  const allSuggestions = [...resolvedSuggestions, ...openSuggestions].filter(
    (entry) => !statuses || statuses.includes(entry.status),
  );
  const allChangeSets = [...revertedChangeSets, ...revertable].filter(
    (entry) =>
      url.searchParams.get("revertable") !== "true" ||
      entry.status === "COMPLETED",
  );
  // The fake pages one suggestion at a time once a filter is given.
  const cursor = url.searchParams.get("suggestionCursor");
  const start = cursor
    ? allSuggestions.findIndex((entry) => entry.id === cursor) + 1
    : 0;
  const pageSize = statuses ? 1 : limit;
  const page = allSuggestions.slice(start, start + pageSize);
  const more = start + pageSize < allSuggestions.length;
  return {
    actions: [],
    suggestions: page,
    changeSets: allChangeSets.slice(0, limit),
    suggestionsHasMore: more,
    changeSetsHasMore: false,
    nextSuggestionCursor: more ? page.at(-1)!.id : null,
    nextChangeSetCursor: null,
  };
}

function renderCenter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AgentControlCenter />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  openSuggestions = [
    suggestion("open1", "OPEN", "older open suggestion"),
    suggestion("open2", "APPROVED", "oldest approved suggestion"),
  ];
  apiFetchMock.mockImplementation(async (path: string) => {
    const url = new URL(path, "http://localhost");
    const body =
      url.pathname === "/api/agent/v1/actions"
        ? timeline(url)
        : url.pathname === "/api/v1/agent-profiles"
          ? { agentProfiles: [] }
          : url.pathname === "/api/agent/v1/providers"
            ? { providerSlots: [], credentials: [] }
            : { integrationAccounts: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  });
});
afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

describe("AgentControlCenter actionable lists", () => {
  it("shows older actionable records past 12 newer resolved ones and pages", async () => {
    renderCenter();

    expect(await screen.findByText("older open suggestion")).toBeTruthy();
    expect(await screen.findByText("older revertable change")).toBeTruthy();
    expect(screen.queryByText("resolved suggestion 0")).toBeNull();
    expect(screen.queryByText("reverted change 0")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Revert change set",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    // The server reported another page of suggestions.
    expect(screen.queryByText("oldest approved suggestion")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Load more suggestions" }),
    );
    expect(await screen.findByText("oldest approved suggestion")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Load more suggestions" }),
      ).toBeNull(),
    );
    expect(
      screen.queryByRole("button", { name: "Load more change sets" }),
    ).toBeNull();
  });

  it("shows the empty message when only resolved suggestions exist", async () => {
    openSuggestions = [];
    renderCenter();
    // The message also shows while loading; wait for the data to land.
    await screen.findByText("older revertable change");
    expect(
      screen.getByText("No suggestions are waiting for review."),
    ).toBeTruthy();
    expect(screen.queryByText("resolved suggestion 0")).toBeNull();
  });
});

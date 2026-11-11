// @vitest-environment happy-dom
/**
 * TASK-071 — a failed agent data query shows an error with a retry, not the
 * section's "nothing here" message.
 */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryState = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const queries = vi.hoisted(() => ({
  profiles: {} as QueryState,
  providers: {} as QueryState,
  integrations: {} as QueryState,
  timeline: {} as QueryState,
}));

vi.mock("@/lib/hooks/use-agent-control", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useAgentProfiles: () => queries.profiles,
    useAgentProviders: () => queries.providers,
    useAgentIntegrations: () => queries.integrations,
    useAgentTimeline: () => queries.timeline,
    useApproveSuggestion: mutation,
    useRejectSuggestion: mutation,
    useExecuteSuggestion: mutation,
    useRevertChangeSet: mutation,
    useDisableAgentProfile: mutation,
  };
});

import { AgentControlCenter } from "./AgentControlCenter";

function ok(data: unknown): QueryState {
  return { data, isLoading: false, isError: false, refetch: vi.fn() };
}
function failed(): QueryState {
  return { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
}

beforeEach(() => {
  queries.profiles = ok({ agentProfiles: [] });
  queries.providers = ok({ providerSlots: [], credentials: [] });
  queries.integrations = ok({ integrationAccounts: [] });
  queries.timeline = ok({ suggestions: [], changeSets: [] });
});
afterEach(cleanup);

describe("AgentControlCenter query failures", () => {
  it("shows an error with retry instead of empty-state text when queries fail", () => {
    queries.profiles = failed();
    queries.timeline = failed();
    render(<AgentControlCenter />);

    expect(screen.queryByText("No agent profiles configured yet.")).toBeNull();
    expect(
      screen.queryByText("No suggestions are waiting for review."),
    ).toBeNull();
    expect(
      screen.queryByText("No change sets have been recorded yet."),
    ).toBeNull();
    expect(
      screen.getByText("Agent profiles could not be loaded."),
    ).toBeTruthy();
    expect(
      screen.getAllByText("Agent activity could not be loaded."),
    ).toHaveLength(2);
    expect(screen.queryByText(/\d+ agents/)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Retry loading agent profiles" }),
    );
    expect(queries.profiles.refetch).toHaveBeenCalledTimes(1);
    // Sections whose query succeeded keep their empty-state text.
    expect(
      screen.getByText("No integration accounts configured yet."),
    ).toBeTruthy();
  });

  it("keeps the empty-state text when every query succeeds with no data", () => {
    render(<AgentControlCenter />);
    expect(screen.getByText("No agent profiles configured yet.")).toBeTruthy();
    expect(
      screen.getByText("No suggestions are waiting for review."),
    ).toBeTruthy();
    expect(screen.getByText("0 agents")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});

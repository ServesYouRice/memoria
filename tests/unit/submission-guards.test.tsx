// @vitest-environment happy-dom

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhisperMode } from "@/features/canvas/components/WhisperMode";

afterEach(cleanup);

describe("quick-capture submission guard", () => {
  it("coalesces repeated Enter presses while a save is in flight", () => {
    let resolveSave: (() => void) | undefined;
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(<WhisperMode open onClose={vi.fn()} onSend={onSend} />);
    const input = screen.getByPlaceholderText("Capture a thought…");

    fireEvent.change(input, { target: { value: "Keep this thought" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Save quick capture",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    resolveSave?.();
  });

  it("preserves typed text and reports a rejected save", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("Save unavailable"));
    render(<WhisperMode open onClose={vi.fn()} onSend={onSend} />);
    const input = screen.getByPlaceholderText("Capture a thought…");

    fireEvent.change(input, { target: { value: "Do not lose this" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Save unavailable",
    );
    await waitFor(() =>
      expect((input as HTMLTextAreaElement).value).toBe("Do not lose this"),
    );
  });
});

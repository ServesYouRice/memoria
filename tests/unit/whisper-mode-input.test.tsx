// @vitest-environment happy-dom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhisperMode } from "@/features/canvas/components/WhisperMode";

afterEach(cleanup);

describe("quick capture input", () => {
  it("is read-only while a save is pending, so later edits cannot be lost", async () => {
    let resolveSave!: () => void;
    const onSend = vi.fn(
      () => new Promise<void>((resolve) => (resolveSave = resolve)),
    );
    render(<WhisperMode open onClose={vi.fn()} onSend={onSend} />);
    const input = screen.getByPlaceholderText(
      "Capture a thought…",
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "First thought" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("First thought");

    expect(input.readOnly).toBe(true);
    fireEvent.change(input, { target: { value: "First thought plus more" } });
    expect(input.value).toBe("First thought");

    await act(async () => resolveSave());
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe("");
  });

  it("does not submit on the Enter that confirms an IME composition", () => {
    const onSend = vi.fn();
    const onClose = vi.fn();
    render(<WhisperMode open onClose={onClose} onSend={onSend} />);
    const input = screen.getByPlaceholderText("Capture a thought…");
    fireEvent.change(input, { target: { value: "にほんご" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

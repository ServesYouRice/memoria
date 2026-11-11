// @vitest-environment happy-dom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(() => cleanup());

function deferred() {
  let reject!: (error: unknown) => void;
  let resolve!: () => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ConfirmDialog", () => {
  it("disables Confirm while onConfirm runs and contains a rejection", async () => {
    const pending = deferred();
    const onConfirm = vi.fn(() => pending.promise);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      render(
        <ConfirmDialog
          open
          title="Restore?"
          message="Replace the board"
          confirmLabel="Restore"
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />,
      );
      const confirm = screen.getByRole("button", { name: "Restore" });
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement)
            .disabled,
        ).toBe(true),
      );

      await act(async () => {
        pending.reject(new Error("network"));
        await pending.promise.catch(() => undefined);
      });
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("still calls a synchronous onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete?"
        message="Gone for good"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

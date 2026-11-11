// @vitest-environment happy-dom
/**
 * CursorChat opens on "/" and must take keyboard focus on its native input,
 * or typed keys reach the global canvas shortcuts (Backspace deletes the
 * selection, "e" opens the reaction picker).
 */
import type React from "react";
import type Konva from "konva";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { name: "Ada Lovelace" } } }),
}));

import { CursorChat } from "@/features/canvas/components/CursorChat";
import { useCanvasKeyboard } from "@/features/canvas/hooks/use-canvas-keyboard";

afterEach(() => cleanup());

describe("CursorChat focus", () => {
  it("focuses the native text input when it opens", () => {
    render(
      <CursorChat x={10} y={10} onSendMessage={vi.fn()} onClose={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText("Say something...");
    expect(input.tagName).toBe("INPUT");
    expect(document.activeElement).toBe(input);
  });

  it("keeps canvas shortcuts off keys typed into the open chat", () => {
    const onDelete = vi.fn();
    const onReactionOpen = vi.fn();
    renderHook(() =>
      useCanvasKeyboard({
        onDelete,
        onCopy: vi.fn(),
        onPaste: vi.fn(),
        onSelectAll: vi.fn(),
        onDuplicate: vi.fn(),
        onEscape: vi.fn(),
        canEdit: true,
        isDrawing: false,
        stageRef: { current: null } as unknown as React.RefObject<Konva.Stage>,
        onChatOpen: vi.fn(),
        onReactionOpen,
        selectedItemIds: new Set<string>(["a"]),
        selectedItemId: "a",
        allItems: [],
        updateItem: vi.fn(),
      }),
    );
    render(
      <CursorChat x={10} y={10} onSendMessage={vi.fn()} onClose={vi.fn()} />,
    );

    const target = (document.activeElement ?? document.body) as HTMLElement;
    fireEvent.keyDown(target, { key: "Backspace" });
    fireEvent.keyDown(target, { key: "e" });

    expect(onDelete).not.toHaveBeenCalled();
    expect(onReactionOpen).not.toHaveBeenCalled();
  });
});

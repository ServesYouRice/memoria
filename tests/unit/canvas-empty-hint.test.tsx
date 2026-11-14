// @vitest-environment happy-dom
/**
 * IMP-141: an empty canvas shows a first step. Editors get the two ways to
 * start; view-only visitors are told the canvas is empty, with no buttons.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CanvasEmptyHint,
  showsCanvasEmptyHint,
} from "@/features/canvas/components/CanvasEmptyHint";

afterEach(cleanup);

describe("CanvasEmptyHint", () => {
  it("offers editors a note or a link", () => {
    const onAddNote = vi.fn();
    const onAddLink = vi.fn();
    render(
      <CanvasEmptyHint canEdit onAddNote={onAddNote} onAddLink={onAddLink} />,
    );

    expect(screen.getByText("Start anywhere")).toBeTruthy();
    expect(
      screen.getByText("Add a note or a link, then drag it wherever you like."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    expect(onAddNote).toHaveBeenCalledTimes(1);
    expect(onAddLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Add a link" }));
    expect(onAddLink).toHaveBeenCalledTimes(1);
  });

  it("tells viewers the canvas is empty, with no buttons", () => {
    render(
      <CanvasEmptyHint
        canEdit={false}
        onAddNote={vi.fn()}
        onAddLink={vi.fn()}
      />,
    );

    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    expect(
      screen.getByText("Nothing has been added to this canvas."),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lets the pointer through everywhere but the buttons", () => {
    const { container } = render(
      <CanvasEmptyHint canEdit onAddNote={vi.fn()} onAddLink={vi.fn()} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(getComputedStyle(wrapper).pointerEvents).toBe("none");
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Add a note" }))
        .pointerEvents,
    ).toBe("auto");
  });
});

describe("showsCanvasEmptyHint", () => {
  const empty = {
    viewMode: "manual" as const,
    presenting: false,
    itemsLoaded: true,
    itemCount: 0,
  };

  it("shows on a loaded, empty free-layout board", () => {
    expect(showsCanvasEmptyHint(empty)).toBe(true);
  });

  it("is absent once the canvas has an item", () => {
    expect(showsCanvasEmptyHint({ ...empty, itemCount: 1 })).toBe(false);
  });

  it("waits for the first load of items", () => {
    expect(showsCanvasEmptyHint({ ...empty, itemsLoaded: false })).toBe(false);
  });

  it("is absent in the list view and in presentation mode", () => {
    expect(showsCanvasEmptyHint({ ...empty, viewMode: "organizer" })).toBe(
      false,
    );
    expect(showsCanvasEmptyHint({ ...empty, presenting: true })).toBe(false);
  });
});

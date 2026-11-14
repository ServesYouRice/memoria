// @vitest-environment happy-dom
/**
 * IMP-130: the "Organised list" tab shows every item as a list that can be
 * filtered and sorted in the browser; the AI organiser sits below it, closed.
 */

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/canvas/components/CanvasOrganizerView", () => ({
  CanvasOrganizerView: () => <p>organiser content</p>,
}));

import { CanvasOrganisedList } from "@/features/canvas/components/CanvasOrganisedList";
import {
  ItemType,
  resolveCanvasCapabilities,
  type CanvasItem,
} from "@/types/canvas";

function item(
  id: string,
  type: ItemType,
  text: string,
  createdAt: string,
  updatedAt: string,
  tags: string[] = [],
): CanvasItem {
  const content =
    type === ItemType.NOTE
      ? { text }
      : { url: "https://example.com", title: text };
  return {
    id,
    canvasId: "c1",
    type,
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    zIndex: 1,
    version: 1,
    tags,
    content,
    createdAt,
    updatedAt,
  } as unknown as CanvasItem;
}

const ITEMS = [
  item(
    "a",
    ItemType.BOOKMARK,
    "Banana link",
    "2026-01-01T00:00:00Z",
    "2026-03-01T00:00:00Z",
    ["fruit"],
  ),
  item(
    "b",
    ItemType.NOTE,
    "Apple plan",
    "2026-01-03T00:00:00Z",
    "2026-02-01T00:00:00Z",
  ),
  item(
    "c",
    ItemType.NOTE,
    "Cherry notes",
    "2026-01-02T00:00:00Z",
    "2026-04-01T00:00:00Z",
  ),
];

afterEach(cleanup);

function renderList(capability: "EDIT" | "VIEW" = "EDIT") {
  const onActivateItem = vi.fn();
  const onDeleteItem = vi.fn();
  render(
    <CanvasOrganisedList
      canvasId="c1"
      items={ITEMS}
      itemCount={ITEMS.length}
      capabilities={resolveCanvasCapabilities(capability)}
      onActivateItem={onActivateItem}
      onDeleteItem={onDeleteItem}
    />,
  );
  return { onActivateItem, onDeleteItem };
}

function itemRows(): HTMLElement[] {
  // The accordion's own header is also a level 3 heading; rows are the ones
  // inside the item list section.
  const section = screen.queryByRole("region", { name: /^Items on/ });
  return section ? within(section).queryAllByRole("heading", { level: 3 }) : [];
}

function rowHeadings(): string[] {
  return itemRows().map((heading) => heading.textContent ?? "");
}

function chooseSort(label: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Sort by" }));
  fireEvent.click(within(screen.getByRole("listbox")).getByText(label));
}

describe("CanvasOrganisedList", () => {
  it("lists every item without any further click", () => {
    renderList();
    expect(rowHeadings()).toHaveLength(3);
    expect(screen.getByRole("status").textContent).toBe("Showing 3 of 3 items");
  });

  it("filters by text and tags, and updates the count", () => {
    renderList();
    const filter = screen.getByLabelText("Filter items");
    fireEvent.change(filter, { target: { value: "APPLE" } });
    expect(rowHeadings()).toEqual(["Apple plan"]);
    expect(screen.getByRole("status").textContent).toBe("Showing 1 of 3 items");
    fireEvent.change(filter, { target: { value: "fruit" } });
    expect(rowHeadings()).toEqual(["Banana link"]);
  });

  it("filters by type and offers only the types that are present", () => {
    renderList();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Type" }));
    const options = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["All types", "bookmark", "note"]);
    fireEvent.click(within(screen.getByRole("listbox")).getByText("bookmark"));
    expect(rowHeadings()).toEqual(["Banana link"]);
  });

  it("sorts as described", () => {
    renderList();
    expect(rowHeadings()).toEqual([
      "Cherry notes",
      "Banana link",
      "Apple plan",
    ]);
    chooseSort("Oldest first");
    expect(rowHeadings()).toEqual([
      "Banana link",
      "Cherry notes",
      "Apple plan",
    ]);
    chooseSort("Name A to Z");
    expect(rowHeadings()).toEqual([
      "Apple plan",
      "Banana link",
      "Cherry notes",
    ]);
    chooseSort("Type");
    expect(rowHeadings()).toEqual([
      "Banana link",
      "Apple plan",
      "Cherry notes",
    ]);
  });

  it("says when nothing matches and clears the filter", () => {
    renderList();
    fireEvent.change(screen.getByLabelText("Filter items"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No items match.")).toBeTruthy();
    expect(itemRows()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(rowHeadings()).toHaveLength(3);
  });

  it("keeps the AI organiser closed until it is opened", () => {
    renderList();
    const summary = screen.getByRole("button", { name: "AI organiser" });
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("organiser content")).toBeNull();
    fireEvent.click(summary);
    expect(screen.getByText("organiser content")).toBeTruthy();
  });

  it("offers Edit and Delete to editors only", () => {
    const { onActivateItem, onDeleteItem } = renderList("EDIT");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    expect(onActivateItem).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    expect(onDeleteItem).toHaveBeenCalledTimes(1);
    cleanup();
    renderList("VIEW");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

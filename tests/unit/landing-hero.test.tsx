// @vitest-environment happy-dom
/* eslint-disable react/display-name -- konva test stubs */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppThemeProvider } from "@/lib/theme-context";
import { LandingInteractiveHero } from "@/components/LandingInteractiveHero";
import { RemoteCursorChat } from "@/features/canvas/components/RemoteCursorChat";
import { ReactionSelector } from "@/features/canvas/components/ReactionSelector";
import { FrameItem } from "@/features/canvas/components/FrameItem";
import { CanvasItemLayer } from "@/features/canvas/components/CanvasItemLayer";
import { fonts } from "@/lib/theme";
import {
  ItemType,
  NO_CANVAS_CAPABILITIES,
  type CanvasItem,
} from "@/types/canvas";

import type * as CanvasMotionModule from "@/features/canvas/lib/canvas-motion";

const konvaCalls = vi.hoisted(() => ({
  animateItemSpawn: vi.fn(),
  tweenKonvaNode: vi.fn(),
}));

vi.mock("@/features/canvas/lib/canvas-motion", async () => {
  const actual = await vi.importActual<typeof CanvasMotionModule>(
    "@/features/canvas/lib/canvas-motion",
  );
  return {
    ...actual,
    animateItemSpawn: (...args: unknown[]) => {
      konvaCalls.animateItemSpawn(...args);
      return actual.animateItemSpawn(
        ...(args as Parameters<typeof actual.animateItemSpawn>),
      );
    },
    tweenKonvaNode: (...args: unknown[]) => {
      konvaCalls.tweenKonvaNode(...args);
      return actual.tweenKonvaNode(
        ...(args as Parameters<typeof actual.tweenKonvaNode>),
      );
    },
  };
});

vi.mock("react-konva", () => {
  const node =
    (name: string) =>
    ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) =>
      React.createElement(
        "div",
        {
          "data-konva": name,
          "data-props": JSON.stringify(props),
        },
        children,
      );
  const groupNode = React.forwardRef<
    HTMLDivElement,
    { children?: React.ReactNode; [key: string]: unknown }
  >(({ children, ...props }, ref) =>
    React.createElement(
      "div",
      {
        ref,
        "data-konva": "Group",
        "data-props": JSON.stringify(props),
      },
      children,
    ),
  );
  return {
    Layer: node("Layer"),
    Group: groupNode,
    Rect: node("Rect"),
    Text: node("Text"),
    Arrow: node("Arrow"),
    Line: node("Line"),
    Circle: node("Circle"),
    Ellipse: node("Ellipse"),
    Image: node("Image"),
    RegularPolygon: node("RegularPolygon"),
    Star: node("Star"),
  };
});

vi.mock("use-image", () => ({ default: () => [undefined, "loading"] }));

function stubReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function makeItem(
  id: string,
  type: ItemType,
  overrides: Partial<CanvasItem> = {},
): CanvasItem {
  return {
    id,
    canvasId: "ccanvas1",
    type,
    positionX: 100,
    positionY: 120,
    width: 220,
    height: 160,
    zIndex: 0,
    content:
      type === ItemType.FRAME
        ? { title: "Sprint Ideas" }
        : { text: "Sample note" },
    tags: [],
    version: 1,
    deletedAt: null,
    createdById: "cuser1",
    updatedById: null,
    deletedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CanvasItem;
}

beforeEach(() => {
  stubReducedMotion(false);
  konvaCalls.animateItemSpawn.mockClear();
  konvaCalls.tweenKonvaNode.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LandingInteractiveHero", () => {
  it("renders draggable cards, live voting poll, and reset control", () => {
    render(
      <AppThemeProvider>
        <LandingInteractiveHero />
      </AppThemeProvider>,
    );

    expect(
      screen.getByRole("region", {
        name: "Interactive Memoria canvas preview",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "Draggable sticky note card" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", {
        name: "Draggable bookmark card: Belém Tower",
      }),
    ).toBeTruthy();

    const resetBtn = screen.getByRole("button", {
      name: "Reset preview layout",
    }) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);

    // Vote on a different poll option
    const lxOption = screen.getByRole("button", { name: /LX Factory market/ });
    expect(lxOption.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(lxOption);
    expect(lxOption.getAttribute("aria-pressed")).toBe("true");
    expect(resetBtn.disabled).toBe(false);

    // Keyboard arrow nudge moves the focused card and enables reset
    const noteCard = screen.getByRole("group", {
      name: "Draggable sticky note card",
    });
    fireEvent.keyDown(noteCard, { key: "ArrowRight" });
    expect(noteCard.style.transform).toContain("translate3d(12px, 0px, 0)");

    fireEvent.click(resetBtn);
    expect(lxOption.getAttribute("aria-pressed")).toBe("false");
    expect(noteCard.style.transform).toContain("translate3d(0px, 0px, 0)");
    expect(resetBtn.disabled).toBe(true);
  });
});

describe("FrameItem pill tab", () => {
  it("renders a top-left floating pill tab with heading font and child count pill", () => {
    const frame = makeItem("f1", ItemType.FRAME, {
      content: { title: "Research" },
      width: 400,
      height: 300,
    });
    const { container } = render(
      <FrameItem
        item={frame}
        isSelected={false}
        capabilities={NO_CANVAS_CAPABILITIES}
        onSelect={vi.fn()}
        onContextMenu={vi.fn()}
        onCommitGeometry={vi.fn()}
        childCount={3}
      />,
    );

    const texts = [...container.querySelectorAll('[data-konva="Text"]')].map(
      (el) => JSON.parse(el.getAttribute("data-props") ?? "{}"),
    );
    expect(texts[0]).toMatchObject({
      text: "Research",
      fontFamily: fonts.heading,
    });
    expect(texts[1]).toMatchObject({
      text: "3",
    });
  });
});

describe("CanvasItemLayer motion and search filtering", () => {
  it("dims non-matching items to 0.18, highlights matches, and animates only newly added items", () => {
    const note1 = makeItem("n1", ItemType.NOTE, {
      positionX: 20,
      positionY: 20,
    });
    const note2 = makeItem("n2", ItemType.NOTE, {
      positionX: 300,
      positionY: 20,
    });
    const frame1 = makeItem("f1", ItemType.FRAME, {
      positionX: 0,
      positionY: 0,
      width: 500,
      height: 400,
      content: { title: "Section A" },
    });

    const baseProps = {
      selectedItemIds: new Set<string>(),
      isSelecting: false,
      selectionBox: null,
      capabilities: NO_CANVAS_CAPABILITIES,
      onSelectItem: vi.fn(),
      onContextMenu: vi.fn(),
      onActivateItem: vi.fn(),
      onCommitGeometry: vi.fn(),
    };

    const { container, rerender } = render(
      <CanvasItemLayer {...baseProps} items={[frame1, note1, note2]} />,
    );

    // Zero spawn animations on initial mount
    expect(konvaCalls.animateItemSpawn).not.toHaveBeenCalled();

    // Frame count pill should derive 2 children inside frame1
    const frameTexts = [
      ...container.querySelectorAll('[data-konva="Text"]'),
    ].map((el) => JSON.parse(el.getAttribute("data-props") ?? "{}").text);
    expect(frameTexts).toContain("2");

    // Activate search matching only note1
    rerender(
      <CanvasItemLayer
        {...baseProps}
        items={[frame1, note1, note2]}
        searchActive
        searchMatchIds={new Set(["n1"])}
      />,
    );

    const groups = [...container.querySelectorAll('[data-konva="Group"]')].map(
      (el) => JSON.parse(el.getAttribute("data-props") ?? "{}"),
    );
    // Filter out inner item groups by looking for opacity prop
    const wrapperOpacities = groups
      .filter((p) => typeof p.opacity === "number")
      .map((p) => p.opacity);
    expect(wrapperOpacities).toContain(0.55); // structural frame
    expect(wrapperOpacities).toContain(1); // matched note1
    expect(wrapperOpacities).toContain(0.18); // dimmed note2

    // Add a newly created local item after mount -> triggers animateItemSpawn once
    const note3 = makeItem("n3", ItemType.NOTE, {
      positionX: 40,
      positionY: 220,
    });
    rerender(
      <CanvasItemLayer
        {...baseProps}
        items={[frame1, note1, note2, note3]}
        searchActive={false}
      />,
    );
    expect(konvaCalls.animateItemSpawn).toHaveBeenCalledTimes(1);
  });
});

describe("RemoteCursorChat & ReactionSelector", () => {
  it("triggers shrink+fade exit during the last 400ms of RemoteCursorChat TTL", () => {
    vi.useFakeTimers();
    const { container } = render(
      <RemoteCursorChat
        x={120}
        y={80}
        message="Looking good!"
        senderName="Ada"
        color="#2c5fc9"
        ttlMs={5000}
      />,
    );

    const wrapper = container.querySelector("[data-exiting]");
    expect(wrapper?.getAttribute("data-exiting")).toBe("false");

    act(() => {
      vi.advanceTimersByTime(4599);
    });
    expect(wrapper?.getAttribute("data-exiting")).toBe("false");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(wrapper?.getAttribute("data-exiting")).toBe("true");
  });

  it("staggers ReactionSelector buttons by 20ms and zeroes stagger when reduced motion is preferred", () => {
    const { unmount } = render(
      <ReactionSelector x={100} y={100} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const buttons = screen.getAllByRole("button");
    expect(
      buttons.map((b) => Number(b.getAttribute("data-stagger-ms"))),
    ).toEqual([0, 20, 40, 60, 80, 100]);
    unmount();

    stubReducedMotion(true);
    render(
      <ReactionSelector x={100} y={100} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(
      screen
        .getAllByRole("button")
        .map((b) => Number(b.getAttribute("data-stagger-ms"))),
    ).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

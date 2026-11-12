// @vitest-environment happy-dom

import React, { Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stageProps = vi.hoisted(() => ({
  last: null as null | { width: number; height: number },
}));

vi.mock("react-konva", () => ({
  Stage: (props: { width: number; height: number }) => {
    stageProps.last = { width: props.width, height: props.height };
    return <div data-testid="stage" />;
  },
}));
vi.mock("@/features/canvas/components/ReadonlyCanvasItemLayer", () => ({
  ReadonlyCanvasItemLayer: () => null,
  ReadonlyCanvasBackground: () => null,
}));
vi.mock("@/features/canvas/components/CanvasAccessiblePanel", () => ({
  CanvasAccessiblePanel: () => null,
}));
vi.mock("@/lib/api/response-schemas", () => ({
  publicCanvasShareResponseSchema: { parse: (value: unknown) => value },
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import SharePage from "@/app/share/[token]/page";

const widthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);
const heightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);

beforeEach(() => {
  stageProps.last = null;
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 1024,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 700,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            canvas: {
              id: "c1",
              name: "Shared",
              owner: "Ada",
              zoomLevel: 1,
              panX: 0,
              panY: 0,
            },
            items: [
              {
                id: "i1",
                type: "NOTE",
                positionX: 0,
                positionY: 0,
                width: 10,
                height: 10,
                zIndex: 0,
                content: {},
              },
            ],
            total: 1,
            hasMore: false,
            nextCursor: null,
            truncatedByBytes: false,
          }),
          { status: 200 },
        ),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (widthDescriptor)
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      widthDescriptor,
    );
  if (heightDescriptor)
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      heightDescriptor,
    );
});

describe("public share page stage size", () => {
  it("sizes the Stage from the container once it mounts, without a resize", async () => {
    const params = Promise.resolve({ token: "tok" });
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <SharePage params={params} />
        </Suspense>,
      );
    });
    await screen.findByTestId("stage");
    await act(async () => {});
    expect(stageProps.last).toEqual({ width: 1024, height: 700 });
  });
});

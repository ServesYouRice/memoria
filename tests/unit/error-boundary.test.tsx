// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: React.forwardRef<HTMLAnchorElement, any>(function Link(
    { children, href, ...props },
    ref,
  ) {
    return (
      <a ref={ref} href={href} {...props}>
        {children}
      </a>
    );
  }),
}));

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CanvasErrorBoundary } from "@/features/canvas/components/CanvasErrorBoundary";

function Bomb({ message, digest }: { message: string; digest?: string }) {
  const err = new Error(message);
  if (digest) {
    (err as any).digest = digest;
  }
  throw err;
}

describe("ErrorBoundary error sanitization", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not render raw arbitrary exception messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb message="sensitive PostgreSQL database password secret leaked" />
      </ErrorBoundary>,
    );

    expect(
      screen.queryByText(
        /sensitive PostgreSQL database password secret leaked/,
      ),
    ).toBeNull();
    expect(
      screen.getByText(
        "An unexpected error occurred while rendering this component.",
      ),
    ).toBeDefined();

    spy.mockRestore();
  });

  it("does not echo a thrown message even when it looks user-facing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb message="The requested canvas could not be found." />
      </ErrorBoundary>,
    );

    expect(
      screen.queryByText("The requested canvas could not be found."),
    ).toBeNull();
    expect(
      screen.getByText(
        "An unexpected error occurred while rendering this component.",
      ),
    ).toBeDefined();

    spy.mockRestore();
  });

  it("renders incident digest when available", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb message="random boom" digest="req-abc-123" />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Incident ID: req-abc-123")).toBeDefined();

    spy.mockRestore();
  });
});

describe("CanvasErrorBoundary error sanitization", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not render raw arbitrary exception messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <CanvasErrorBoundary>
        <Bomb message="Uncaught TypeError: cannot read properties of null at internal/eval" />
      </CanvasErrorBoundary>,
    );

    expect(
      screen.queryByText(/Uncaught TypeError: cannot read properties of null/),
    ).toBeNull();
    expect(
      screen.getByText(
        "An unexpected error occurred while rendering the canvas.",
      ),
    ).toBeDefined();

    spy.mockRestore();
  });

  it("renders the incident digest instead of the thrown message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <CanvasErrorBoundary>
        <Bomb
          message="You do not have permission to view this canvas."
          digest="incident-canvas-999"
        />
      </CanvasErrorBoundary>,
    );

    expect(
      screen.queryByText("You do not have permission to view this canvas."),
    ).toBeNull();
    expect(screen.getByText("Incident ID: incident-canvas-999")).toBeDefined();

    spy.mockRestore();
  });

  it("omits the incident line when the error carries no digest", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <CanvasErrorBoundary>
        <Bomb message="boom" />
      </CanvasErrorBoundary>,
    );

    expect(screen.queryByText(/Incident ID:/)).toBeNull();

    spy.mockRestore();
  });
});

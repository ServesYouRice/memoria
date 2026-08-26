// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RemoteCursor } from "@/features/canvas/components/RemoteCursor";

describe("RemoteCursor", () => {
  it("renders a stable named cursor in the accessibility tree", () => {
    const { rerender } = render(
      <RemoteCursor
        userId="user-alice"
        name="Alice"
        color="#345678"
        x={100}
        y={200}
      />,
    );
    const cursor = screen.getByRole("img", { name: "Alice's cursor" });
    const variant = cursor.getAttribute("data-cursor-variant");
    expect(cursor.getAttribute("data-user-id")).toBe("user-alice");
    expect(screen.getByText("Alice").textContent).toBe("Alice");

    rerender(
      <RemoteCursor
        userId="user-alice"
        name="Alice"
        color="#345678"
        x={140}
        y={240}
      />,
    );
    expect(
      screen
        .getByRole("img", { name: "Alice's cursor" })
        .getAttribute("data-cursor-variant"),
    ).toBe(variant);
  });
});

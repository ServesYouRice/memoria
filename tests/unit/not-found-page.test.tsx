// @vitest-environment happy-dom
/** IMP-120 — the not-found page says "Page not found" in plain words. */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import NotFound from "@/app/not-found";

afterEach(cleanup);

describe("not-found page", () => {
  it("uses plain wording with one h1", () => {
    const { container } = render(<NotFound />);
    const text = container.textContent ?? "";
    for (const banned of ["404", "Oops", "void", "canvas you"]) {
      expect(text).not.toContain(banned);
    }
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("Page not found");
    expect(screen.getByText("The link may be old or mistyped.")).toBeTruthy();
  });

  it("links to canvases, search and home", () => {
    render(<NotFound />);
    expect(
      screen
        .getByRole("link", { name: "Go to my canvases" })
        .getAttribute("href"),
    ).toBe("/dashboard");
    expect(
      screen.getByRole("link", { name: "Search" }).getAttribute("href"),
    ).toBe("/search");
    expect(
      screen.getByRole("link", { name: "Memoria home" }).getAttribute("href"),
    ).toBe("/");
  });
});

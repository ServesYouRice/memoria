// @vitest-environment happy-dom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BLANK_TEMPLATE,
  TemplatePicker,
} from "@/features/dashboard/components/TemplatePicker";
import {
  BUILT_IN_TEMPLATES,
  summarizeTemplate,
} from "@/lib/templates/built-in";

afterEach(cleanup);

describe("New canvas template picker (IMP-098)", () => {
  it("offers a blank canvas and every template with a preview", () => {
    const onChange = vi.fn();
    const templates = BUILT_IN_TEMPLATES.map(summarizeTemplate);
    const { container } = render(
      <TemplatePicker
        templates={templates}
        loading={false}
        value={BLANK_TEMPLATE}
        onChange={onChange}
      />,
    );
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(templates.length + 1);
    expect(
      screen
        .getByRole("radio", { name: "Blank canvas" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.querySelectorAll("svg rect").length).toBeGreaterThan(
      templates.length,
    );
    fireEvent.click(screen.getByRole("radio", { name: "To-do list" }));
    expect(onChange).toHaveBeenCalledWith("todo-list");
  });
});

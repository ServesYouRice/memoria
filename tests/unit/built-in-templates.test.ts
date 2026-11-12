import { describe, expect, it } from "vitest";
import {
  BUILT_IN_TEMPLATES,
  summarizeTemplate,
  templatePlan,
} from "@/lib/templates/built-in";
import { resolvePlan } from "@/lib/canvas-formats/import-canvas";

describe("built-in templates (IMP-098)", () => {
  it("has 10 to 20 templates with unique ids and plain names", () => {
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(BUILT_IN_TEMPLATES.length).toBeLessThanOrEqual(20);
    const ids = BUILT_IN_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.name).not.toMatch(/board/i);
      expect(template.description.length).toBeGreaterThan(5);
    }
  });

  it.each(BUILT_IN_TEMPLATES.map((template) => [template.id, template]))(
    "%s passes the same checks as any saved item, arrows included",
    (_id, template) => {
      const { rows, leftOut } = resolvePlan(templatePlan(template));
      expect(leftOut).toEqual({});
      expect(rows).toHaveLength(template.items.length);
      for (const row of rows.filter((r) => r.planned.type === "ARROW")) {
        expect(row.content.startItemId).toBeTruthy();
        expect(row.content.endItemId).toBeTruthy();
      }
      expect(summarizeTemplate(template).preview.length).toBeGreaterThan(0);
    },
  );
});

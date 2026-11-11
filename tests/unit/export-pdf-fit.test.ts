import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  image: { width: 1000, height: 500 },
  addImage: vi.fn(),
  save: vi.fn(),
}));

vi.mock("jspdf", () => ({
  jsPDF: class {
    internal = {
      pageSize: { getWidth: () => 297, getHeight: () => 210 },
    };
    getImageProperties() {
      return state.image;
    }
    addImage = state.addImage;
    save = state.save;
  },
}));

import { exportToPDF } from "@/lib/export/export-utils";

const capture = "data:image/png;base64,AAAA";

function drawn() {
  const [, , x, y, w, h] = state.addImage.mock.calls[0];
  return { x, y, w, h };
}

describe("exportToPDF page fit", () => {
  beforeEach(() => {
    state.addImage.mockReset();
    state.save.mockReset();
  });

  it("fits a tall snapshot inside the page height, keeping the aspect ratio", async () => {
    state.image = { width: 600, height: 1200 };
    await exportToPDF("board", capture);
    const { x, y, w, h } = drawn();
    expect(h).toBeLessThanOrEqual(210 + 1e-9);
    expect(w).toBeLessThanOrEqual(297 + 1e-9);
    expect(w / h).toBeCloseTo(0.5);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(state.save).toHaveBeenCalledWith("board.pdf");
  });

  it("still fills the page width with a wide snapshot", async () => {
    state.image = { width: 2000, height: 500 };
    await exportToPDF("board", capture);
    const { x, w, h } = drawn();
    expect(w).toBeCloseTo(297);
    expect(h).toBeCloseTo(297 / 4);
    expect(x).toBeCloseTo(0);
  });
});

// @vitest-environment happy-dom
/**
 * IMP-091: Settings > Import shows what a file holds, lets the person pick
 * where links go, and reports the result with every count.
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BookmarkImportSettings,
  ImportResult,
  type ImportStatus,
} from "@/app/settings/BookmarkImportSettings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const done: ImportStatus = {
  id: "climportxxxxxxxxxxxxxxxxx",
  status: "COMPLETED",
  fileName: "bookmarks.html",
  total: 2500,
  processed: 2500,
  imported: 2000,
  duplicates: 300,
  overLimit: 190,
  invalid: 6,
  failed: 4,
  error: null,
};

describe("import screen", () => {
  it("previews a file and starts the import with the chosen options", async () => {
    const calls: { url: string; body?: FormData }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body as FormData | undefined });
        if (url === "/api/v1/imports" && !init?.method) {
          return json({ imports: [] });
        }
        if (url === "/api/v1/imports/preview") {
          return json({
            fileName: "bookmarks.html",
            format: "html",
            links: 2500,
            folders: ["Travel", "Work"],
            duplicates: 300,
            invalid: 6,
          });
        }
        return json({ ...done, status: "QUEUED", processed: 0 }, 202);
      }),
    );
    render(<BookmarkImportSettings />);
    fireEvent.change(screen.getByLabelText("Bookmark file"), {
      target: {
        files: [
          new File(["<a href='https://x.example'>x</a>"], "bookmarks.html"),
        ],
      },
    });
    expect(await screen.findByText("2,500 links")).toBeTruthy();
    expect(screen.getByText("2 top-level folders")).toBeTruthy();
    expect(screen.getByText(/300 already saved/)).toBeTruthy();

    fireEvent.click(
      screen.getByLabelText("One canvas for each top-level folder"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import 2,200 links" }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.url === "/api/v1/imports" && call.body),
      ).toBe(true),
    );
    const sent = calls.find(
      (call) => call.url === "/api/v1/imports" && call.body,
    )!.body!;
    expect(sent.get("destination")).toBe("FOLDERS");
    // AI stays off unless ticked.
    expect(sent.get("enrich")).toBe("false");
    expect(await screen.findByLabelText("Import progress")).toBeTruthy();
  });

  it("says why a file cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/v1/imports"
          ? json({ imports: [] })
          : json(
              { detail: "This CSV file has no link column (url or link)." },
              400,
            ),
      ),
    );
    render(<BookmarkImportSettings />);
    fireEvent.change(screen.getByLabelText("Bookmark file"), {
      target: { files: [new File(["a,b"], "x.csv")] },
    });
    expect(await screen.findByText(/no link column/)).toBeTruthy();
  });

  it("reports every count, including what did not fit", () => {
    render(<ImportResult status={done} />);
    const result = screen.getByRole("status").textContent ?? "";
    expect(result).toContain("2,000 imported");
    expect(result).toContain("300 already saved, skipped");
    expect(result).toContain("190 did not fit");
    expect(result).toContain("10 could not be read");
  });
});

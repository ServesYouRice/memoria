/**
 * IMP-091: bookmark files from browsers, Pocket and Raindrop are read as
 * untrusted data.
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  MAX_IMPORT_LINKS,
  csvRows,
  parseBookmarkFile,
  parseBookmarksCsv,
  parseBookmarksHtml,
} from "@/lib/import/bookmark-file";

const BROWSER = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Travel</H3>
    <DL><p>
        <DT><A HREF="https://example.com/lisbon" ADD_DATE="1700000001" TAGS="city,food">Lisbon <b>guide</b></A>
        <DT><H3>Hotels</H3>
        <DL><p>
            <DT><A HREF="https://example.com/hotel">Hotel</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="javascript:alert(1)">Bad</A>
    <DT><A HREF="https://example.com/loose">Loose <script>x()</script></A>
</DL><p>`;

describe("browser bookmarks HTML", () => {
  const parsed = parseBookmarksHtml(BROWSER);

  it("keeps http links with folders as tags", () => {
    expect(parsed.links).toEqual([
      {
        url: "https://example.com/lisbon",
        title: "Lisbon guide",
        tags: ["Travel", "city", "food"],
        folder: "Travel",
        addedAt: "2023-11-14T22:13:21.000Z",
      },
      {
        url: "https://example.com/hotel",
        title: "Hotel",
        tags: ["Travel", "Hotels"],
        folder: "Travel",
        addedAt: null,
      },
      expect.objectContaining({
        url: "https://example.com/loose",
        folder: null,
        tags: [],
      }),
    ]);
    expect(parsed.folders).toEqual(["Travel"]);
    expect(parsed.invalid).toBe(1);
  });

  it("never keeps markup from the file", () => {
    expect(parsed.links.map((link) => link.title).join(" ")).not.toMatch(/</);
  });

  it("is recognised without a file name", () => {
    expect(parseBookmarkFile(BROWSER).format).toBe("html");
  });
});

function refusal(read: () => unknown) {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as ValidationError).detail;
  }
  throw new Error("expected the file to be refused");
}

describe("CSV exports", () => {
  it("reads a Pocket-style file", () => {
    const parsed = parseBookmarksCsv(
      'title,url,time_added,tags,status\n"Hello, world",https://a.example/x,1700000000,read|later,unread\n',
    );
    expect(parsed.links).toEqual([
      {
        url: "https://a.example/x",
        title: "Hello, world",
        tags: ["read", "later"],
        folder: null,
        addedAt: "2023-11-14T22:13:20.000Z",
      },
    ]);
  });

  it("reads a Raindrop-style file with nested folders", () => {
    const parsed = parseBookmarkFile(
      '﻿id,title,note,excerpt,url,folder,tags,created\r\n1,Doc,,,https://b.example/,Work/Docs,"a, b",2024-01-02T03:04:05.000Z\r\n',
      "export.csv",
    );
    expect(parsed.format).toBe("csv");
    expect(parsed.links[0]).toMatchObject({
      folder: "Work",
      tags: ["Work", "Docs", "a", "b"],
      addedAt: "2024-01-02T03:04:05.000Z",
    });
    expect(parsed.folders).toEqual(["Work"]);
  });

  it("counts rows without a usable link", () => {
    const parsed = parseBookmarksCsv("url\nftp://x.example/\nnot a link\n");
    expect(parsed.links).toHaveLength(0);
    expect(parsed.invalid).toBe(2);
  });

  it("refuses a file without a link column", () => {
    expect(refusal(() => parseBookmarksCsv("title,notes\nx,y\n"))).toMatch(
      /no link column/,
    );
  });

  it("refuses a file with too many links", () => {
    const body = Array.from(
      { length: MAX_IMPORT_LINKS + 1 },
      (_, i) => `https://c.example/${i}`,
    ).join("\n");
    expect(refusal(() => parseBookmarksCsv(`url\n${body}`))).toMatch(
      /more than/,
    );
  });

  it("splits quoted fields with newlines and doubled quotes", () => {
    expect(csvRows('a,"b ""c""\nd"\r\n1,2')).toEqual([
      ["a", 'b "c"\nd'],
      ["1", "2"],
    ]);
  });
});

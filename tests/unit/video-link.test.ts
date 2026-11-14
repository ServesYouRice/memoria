import { describe, expect, it } from "vitest";
import {
  MAX_VIDEO_SECONDS,
  formatVideoTime,
  parseVideoLink,
  parseVideoTime,
  videoUrlAt,
} from "@/lib/video/video-link";

describe("parseVideoLink (IMP-114)", () => {
  it("knows YouTube, Vimeo and Loom addresses", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://m.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(parseVideoLink(url)).toEqual({
        provider: "youtube",
        id: "dQw4w9WgXcQ",
        source: "YouTube",
      });
    }
    expect(parseVideoLink("https://vimeo.com/76979871")).toMatchObject({
      provider: "vimeo",
      id: "76979871",
    });
    expect(
      parseVideoLink("https://player.vimeo.com/video/76979871?h=1"),
    ).toMatchObject({ provider: "vimeo", id: "76979871" });
    expect(
      parseVideoLink(
        "https://www.loom.com/share/0123456789abcdef0123456789abcdef",
      ),
    ).toMatchObject({ provider: "loom", source: "Loom" });
  });

  it("is null for anything else", () => {
    for (const value of [
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/@channel",
      "https://evil.example/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)//youtu.be/dQw4w9WgXcQ",
      "https://vimeo.com/about",
      "not a url",
      42,
      null,
    ]) {
      expect(parseVideoLink(value)).toBeNull();
    }
  });
});

describe("videoUrlAt", () => {
  it("opens the video at the moment, built from the video id", () => {
    const youtube = parseVideoLink("https://youtu.be/dQw4w9WgXcQ?si=tracking")!;
    expect(videoUrlAt(youtube, 65)).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=65s",
    );
    expect(videoUrlAt(youtube, 0)).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(videoUrlAt(parseVideoLink("https://vimeo.com/76979871")!, 90)).toBe(
      "https://vimeo.com/76979871#t=90s",
    );
    expect(
      videoUrlAt(
        parseVideoLink("https://www.loom.com/share/0123456789abcdef")!,
        12.7,
      ),
    ).toBe("https://www.loom.com/share/0123456789abcdef?t=12");
  });
});

describe("video times", () => {
  it("formats seconds", () => {
    expect(formatVideoTime(5)).toBe("0:05");
    expect(formatVideoTime(65)).toBe("1:05");
    expect(formatVideoTime(3723)).toBe("1:02:03");
  });

  it("reads what people type", () => {
    expect(parseVideoTime("75")).toBe(75);
    expect(parseVideoTime(" 1:15 ")).toBe(75);
    expect(parseVideoTime("1:02:03")).toBe(3723);
    expect(parseVideoTime("1h2m3s")).toBe(3723);
    expect(parseVideoTime("2m")).toBe(120);
    expect(parseVideoTime("")).toBeNull();
    expect(parseVideoTime("1:99")).toBeNull();
    expect(parseVideoTime("soon")).toBeNull();
    expect(parseVideoTime(String(MAX_VIDEO_SECONDS + 1))).toBeNull();
  });
});

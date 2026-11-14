import { describe, expect, it, vi } from "vitest";
import {
  captionTrackUrl,
  extractCaptionTracks,
  fetchYoutubeCaptions,
  parseTimedText,
  pickCaptionTrack,
} from "@/lib/video/youtube-captions";

const TRACK = "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en";

function watchPage(tracks: unknown[]) {
  // The page embeds the tracks inside a larger JSON blob, with &.
  const json = JSON.stringify({
    captions: {
      playerCaptionsTracklistRenderer: { captionTracks: tracks },
    },
  }).replace(/&/g, "\\u0026");
  return `<html><script>var ytInitialPlayerResponse = ${json};</script></html>`;
}

describe("YouTube caption reading (IMP-114)", () => {
  it("finds the caption tracks a watch page lists", () => {
    const tracks = extractCaptionTracks(
      watchPage([
        {
          baseUrl: TRACK,
          languageCode: "en",
          kind: "asr",
          name: { simpleText: "a]b" },
        },
        { baseUrl: `${TRACK}&x=1`, languageCode: "de" },
      ]),
    );
    expect(tracks).toEqual([
      { baseUrl: TRACK, languageCode: "en", kind: "asr" },
      { baseUrl: `${TRACK}&x=1`, languageCode: "de" },
    ]);
    expect(extractCaptionTracks("<html>no captions</html>")).toEqual([]);
    expect(extractCaptionTracks('"captionTracks":[{broken')).toEqual([]);
  });

  it("prefers captions written by people, then English", () => {
    const asrEn = { baseUrl: "a", languageCode: "en", kind: "asr" };
    const manualDe = { baseUrl: "b", languageCode: "de" };
    const manualEn = { baseUrl: "c", languageCode: "en-GB" };
    expect(pickCaptionTrack([asrEn, manualDe, manualEn])).toBe(manualEn);
    expect(pickCaptionTrack([manualDe, asrEn])).toBe(asrEn);
    expect(pickCaptionTrack([])).toBeUndefined();
  });

  it("follows only YouTube's own caption address", () => {
    expect(captionTrackUrl(TRACK)).toBe(TRACK);
    expect(captionTrackUrl("/api/timedtext?v=1")).toBe(
      "https://www.youtube.com/api/timedtext?v=1",
    );
    expect(captionTrackUrl("https://evil.example/api/timedtext")).toBeNull();
    expect(captionTrackUrl("https://www.youtube.com/redirect?q=x")).toBeNull();
    expect(captionTrackUrl("http://127.0.0.1/api/timedtext")).toBeNull();
  });

  it("reads both caption layouts as plain text", () => {
    expect(
      parseTimedText(
        '<transcript><text start="1.5" dur="2">It&amp;#39;s &lt;b&gt;here&lt;/b&gt;</text><text start="65" dur="1">  next\nline </text><text start="70"></text></transcript>',
      ),
    ).toEqual([
      { start: 1.5, text: "It's here" },
      { start: 65, text: "next line" },
    ]);
    expect(
      parseTimedText(
        '<timedtext format="3"><body><p t="2500" d="10"><s>Hello</s><s> world</s></p></body></timedtext>',
      ),
    ).toEqual([{ start: 2.5, text: "Hello world" }]);
  });

  it("fetches the page and the track through the given fetcher", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: watchPage([{ baseUrl: TRACK, languageCode: "en" }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: '<transcript><text start="65">The quokka.</text></transcript>',
      });
    await expect(
      fetchYoutubeCaptions("dQw4w9WgXcQ", { fetchImpl }),
    ).resolves.toEqual({ ok: true, text: "1:05 The quokka.", language: "en" });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&hl=en",
      expect.objectContaining({ maxSize: 4 * 1024 * 1024 }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(2, TRACK, expect.any(Object));
  });

  it("ends quietly when there are no captions, and says when YouTube did not answer", async () => {
    const noTracks = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, data: "<html></html>" });
    await expect(
      fetchYoutubeCaptions("dQw4w9WgXcQ", { fetchImpl: noTracks }),
    ).resolves.toEqual({ ok: false, reason: "no-captions" });
    expect(noTracks).toHaveBeenCalledTimes(1);

    const down = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, error: "HTTP 429" });
    await expect(
      fetchYoutubeCaptions("dQw4w9WgXcQ", { fetchImpl: down }),
    ).resolves.toEqual({ ok: false, reason: "unavailable", status: 429 });

    const emptyTrack = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: watchPage([{ baseUrl: TRACK, languageCode: "en" }]),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: "" });
    await expect(
      fetchYoutubeCaptions("dQw4w9WgXcQ", { fetchImpl: emptyTrack }),
    ).resolves.toEqual({ ok: false, reason: "no-captions" });
  });
});

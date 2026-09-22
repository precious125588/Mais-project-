import assert from "node:assert/strict";
import {
  dcRequest,
  dcGetBinary,
  extractDcSpotify,
  extractDcTiktok,
} from "../mias/davidcyril.js";

const unsupported = await dcRequest("/test", { method: "TRACE" });
assert.equal(unsupported.ok, false);
assert.match(unsupported.error, /Unsupported method/);

const unsafe = await dcRequest("https://example.com", { method: "GET" });
assert.equal(unsafe.ok, false);
assert.match(unsafe.error, /must be an absolute API path/);

const malformed = await dcGetBinary("not-a-path");
assert.equal(malformed, null);

assert.deepEqual(extractDcSpotify({
  result: {
    download_url: "https://cdn.example.test/song.mp3",
    title: "Song",
    artists: [{ name: "Artist" }],
    duration: 125,
  },
}), {
  dlUrl: "https://cdn.example.test/song.mp3",
  title: "Song",
  artists: "Artist",
  thumbUrl: null,
  duration: "2:05",
});

assert.equal(
  extractDcTiktok({ data: { hdplay: "https://cdn.example.test/video.mp4" } }),
  "https://cdn.example.test/video.mp4",
);
assert.equal(
  extractDcTiktok({ data: { music: "https://cdn.example.test/audio.mp3" } }, true),
  "https://cdn.example.test/audio.mp3",
);

console.log("DavidCyril client contract tests passed.");
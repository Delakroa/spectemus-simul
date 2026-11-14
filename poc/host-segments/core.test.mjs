import assert from "node:assert/strict";
import test from "node:test";
import { inspectMovie, movieMime, remuxArguments } from "./prepare.mjs";
import {
  bufferedAhead,
  validManifest,
  remotePlaybackIntent,
} from "./public/player.mjs";

const inventory = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      pix_fmt: "yuv420p",
      extradata: "\n00000000: 0164 001f ffe1 0018 6764 001f  .d......gd..\n",
    },
    { codec_type: "audio", codec_name: "aac", profile: "LC" },
  ],
  format: { duration: "24.1" },
};
test("prepared MIME comes from AVC record and AAC-LC, not a guessed H.264 profile", () => {
  assert.equal(
    movieMime(inspectMovie(JSON.stringify(inventory))),
    'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
  );
  assert.throws(() => movieMime({ video: {} }), /AVC/);
});
test("unsupported video/audio fail instead of silently launching expensive transcode", () => {
  for (const change of [{ codec_name: "hevc" }, { pix_fmt: "yuv420p10le" }]) {
    const copy = structuredClone(inventory);
    Object.assign(copy.streams[0], change);
    assert.throws(() => inspectMovie(JSON.stringify(copy)), /PoC принимает/);
  }
  const copy = structuredClone(inventory);
  copy.streams[1].profile = "HE-AAC";
  assert.throws(() => inspectMovie(JSON.stringify(copy)), /PoC принимает/);
});
test("remux explicitly copies streams and strips metadata; never uses a video encoder", () => {
  const args = remuxArguments("movie.mkv", "output.mp4");
  assert.equal(args[args.indexOf("-c") + 1], "copy");
  assert.equal(args[args.indexOf("-map_metadata") + 1], "-1");
  assert.equal(args.includes("libx264"), false);
  assert.equal(args[args.indexOf("-frag_duration") + 1], "2000000");
});
test("manifest rejects arbitrary codecs, oversized chunk negotiation and invalid size", () => {
  const value = {
    version: 1,
    mime: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
    size: 100,
    duration: 24,
    chunkBytes: 65536,
  };
  assert.equal(validManifest(value), true);
  for (const change of [
    { chunkBytes: 1_000_000 },
    { size: -1 },
    { mime: "text/html" },
    { duration: NaN },
  ])
    assert.equal(validManifest({ ...value, ...change }), false);
});
test("buffer credit uses the current playback range, not unrelated buffered intervals", () => {
  const video = {
    currentTime: 5,
    buffered: {
      length: 2,
      start: (index) => [0, 20][index],
      end: (index) => [12, 30][index],
    },
  };
  assert.equal(bufferedAhead(video), 7);
  video.currentTime = 15;
  assert.equal(bufferedAhead(video), 0);
});
test("host ended lets guest finish its last frames but never restarts an ended guest", () => {
  assert.equal(
    remotePlaybackIntent({ playing: false, ended: true }, false),
    true,
  );
  assert.equal(
    remotePlaybackIntent({ playing: false, ended: true }, true),
    false,
  );
  assert.equal(
    remotePlaybackIntent({ playing: false, ended: false }, false),
    false,
  );
});

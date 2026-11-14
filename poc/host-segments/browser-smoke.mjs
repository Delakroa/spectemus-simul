import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareMovie, run } from "./prepare.mjs";
import { startPoc } from "./server.mjs";

const require = createRequire(
  new URL("../../e2e/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const directory = await mkdtemp(join(tmpdir(), "spectemus-segment-smoke-"));
let prepared, session, browser;
try {
  const input = join(directory, "synthetic.mkv");
  await run(
    process.env.FFMPEG ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-n",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "24",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "60",
      "-c:a",
      "aac",
      "-shortest",
      input,
    ],
    60_000,
  );
  prepared = await prepareMovie({
    input,
    ffmpeg: process.env.FFMPEG ?? "ffmpeg",
    ffprobe: process.env.FFPROBE ?? "ffprobe",
  });
  session = await startPoc(prepared);
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--allow-loopback-in-peer-connection",
      "--disable-features=WebRtcHideLocalIpsWithMdns",
    ],
  });
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const loopbackAdapter = process.env.POC_NATIVE_ICE !== "true";
  if (loopbackAdapter) {
    // Test-only network adapter: keep real DTLS/SCTP, but route host candidates
    // to loopback. Product app never rewrites SDP. This is NOT NAT evidence.
    for (const context of [hostContext, guestContext]) {
      await context.addInitScript(() => {
        const original = RTCPeerConnection.prototype.setRemoteDescription;
        RTCPeerConnection.prototype.setRemoteDescription = function (
          description,
        ) {
          return original.call(this, {
            type: description.type,
            sdp: description.sdp.replace(
              /^(a=candidate:\S+ \d+ \S+ \d+ )\S+( \d+ typ host.*)$/gm,
              (_match, prefix, suffix) => `${prefix}127.0.0.1${suffix}`,
            ),
          });
        };
      });
    }
  }
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors = [];
  host.on("pageerror", (error) => errors.push(error));
  guest.on("pageerror", (error) => errors.push(error));
  await host.goto(session.hostUrl);
  await guest.goto(session.guestUrl);
  await host.locator("#connect").click();
  await guest.locator("#connect").click();
  await guest
    .waitForFunction(
      () => {
        const m = JSON.parse(document.getElementById("metrics").textContent);
        return m.aheadSeconds >= 10 && m.connection === "connected";
      },
      null,
      { timeout: 20_000 },
    )
    .catch(async (error) => {
      console.error(
        JSON.stringify({
          host: await host.locator("#status").textContent(),
          guest: await guest.locator("#status").textContent(),
          hostMetrics: await host.locator("#metrics").textContent(),
          guestMetrics: await guest.locator("#metrics").textContent(),
          pageErrors: errors.map((item) => item.message),
        }),
      );
      throw error;
    });
  const before = JSON.parse(await guest.locator("#metrics").textContent());
  assert.ok(
    before.bytes < prepared.manifest.size,
    "paused receiver must not preload the whole movie",
  );
  assert.ok(
    before.aheadSeconds <= 15,
    "MSE ahead is bounded by target plus a chunk",
  );
  await host.locator("#play").click();
  await guest.waitForFunction(
    () => document.getElementById("video").currentTime > 3,
    null,
    { timeout: 10_000 },
  );
  await host.locator("#pause").click();
  const paused = await guest
    .locator("#video")
    .evaluate((video) => video.currentTime);
  await guest.waitForTimeout(1200);
  assert.ok(
    Math.abs(
      (await guest.locator("#video").evaluate((video) => video.currentTime)) -
        paused,
    ) < 0.7,
  );
  await host.locator("#play").click();
  await guest.waitForFunction(
    () => document.getElementById("video").ended,
    null,
    { timeout: 35_000 },
  );
  const evidence = await guest.locator("#video").evaluate((video) => ({
    time: video.currentTime,
    decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames,
    decodedAudioBytes: video.webkitAudioDecodedByteCount ?? null,
    error: video.error?.code ?? null,
  }));
  assert.equal(evidence.error, null);
  assert.ok(evidence.decodedFrames > 100);
  assert.ok(evidence.time > 23);
  assert.equal(errors.length, 0, "no unhandled page errors");
  await host.locator("#stop").click();
  await guest.waitForFunction(
    () =>
      document.getElementById("video").getAttribute("src") === null &&
      document.getElementById("connect").disabled,
    null,
    { timeout: 5_000 },
  );
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        scope: "loopback Chromium, direct DataChannel, stream-copy fMP4",
        iceMode: loopbackAdapter ? "test-loopback-candidate-rewrite" : "native",
        preparation: prepared.preparation,
        pausedAheadSeconds: before.aheadSeconds,
        pausedBytes: before.bytes,
        evidence,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await session?.stop();
  await prepared?.dispose();
  await rm(directory, { recursive: true, force: true });
}

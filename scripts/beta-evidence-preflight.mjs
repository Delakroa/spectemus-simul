// WT-603 beta evidence run — semi-automated pre-flight.
// Confirms the evidence-collection pipeline is live on the target stand (health, WT-604 telemetry
// intake, WT-601 feedback intake, optional WT-605 feedback operations, security headers) and prints the run plan. It complements
// `pnpm beta:smoke` (full room/media-token round-trip); run both before inviting testers.
// Target: WT_BETA_BASE_URL / WT_APP_URL (default http://127.0.0.1:8088).

const baseUrl = normalizeBaseUrl(
  process.env.WT_BETA_BASE_URL ??
    process.env.WT_APP_URL ??
    "http://127.0.0.1:8088",
);

const uuidPattern = /^[0-9a-f-]{36}$/;
const failures = [];

function check(ok, message) {
  console.log(`${ok ? "[ok]" : "[FAIL]"} ${message}`);
  if (!ok) {
    failures.push(message);
  }
}

const shell = await getText("/");
check(
  shell.status === 200 && shell.body.includes('<div id="root"></div>'),
  `frontend shell reachable: ${baseUrl.href}`,
);
const csp = shell.headers.get("content-security-policy") ?? "";
check(
  csp.includes("connect-src") && !csp.includes("${"),
  "CSP present with substituted connect-src (WT-606)",
);
check(
  (shell.headers.get("strict-transport-security") ?? "").includes("max-age"),
  "HSTS header present (WT-606)",
);

const health = await getJson("/api/v1/health");
check(
  health.status === 200 && health.body?.status === "UP",
  "backend health UP through proxy",
);

const telemetry = await postJson("/api/v1/telemetry", {
  events: [{ type: "QUALITY_SUMMARY", role: "GUEST", qualityStatus: "GOOD" }],
});
check(
  telemetry.status === 202 &&
    uuidPattern.test(telemetry.body?.telemetryId ?? ""),
  "telemetry intake accepts events (WT-604)",
);

const feedback = await postJson("/api/v1/feedback", {
  outcome: "WORKED",
  reason: "SUCCESS",
  message: "beta-evidence-preflight",
});
check(
  feedback.status === 202 && uuidPattern.test(feedback.body?.feedbackId ?? ""),
  "feedback intake accepts reports (WT-601)",
);

const feedbackAdminToken =
  process.env.FEEDBACK_ADMIN_TOKEN ?? process.env.WT_FEEDBACK_ADMIN_TOKEN;
if (feedbackAdminToken) {
  const reports = await getJson("/api/v1/feedback/reports?limit=5", {
    "X-Feedback-Admin-Token": feedbackAdminToken,
  });
  check(
    reports.status === 200 &&
      Array.isArray(reports.body?.reports) &&
      reports.body.reports.some(
        (report) => report.feedbackId === feedback.body?.feedbackId,
      ),
    "feedback operations list latest reports (WT-605)",
  );
} else {
  console.log(
    "[warn] FEEDBACK_ADMIN_TOKEN is not set — skip WT-605 operator export check",
  );
}

if (baseUrl.protocol !== "https:" && !isLocalhost(baseUrl)) {
  console.log(
    "[warn] target is remote but not HTTPS — the beta gate requires HTTPS + wss:// LiveKit + SESSION_COOKIE_SECURE=true",
  );
}

printRunPlan();

if (failures.length > 0) {
  console.error(
    `\npreflight FAILED: ${failures.length} check(s) — stand is NOT ready for an evidence session`,
  );
  process.exit(1);
}
console.log(
  "\npreflight passed — evidence pipeline is live. Run `pnpm beta:smoke`, complete the manual smokes, then execute the scenarios and fill docs/WT-603_BETA_EVIDENCE_RUN.md.",
);

function printRunPlan() {
  console.log(
    [
      "",
      "── evidence run plan (see docs/WT-603_BETA_EVIDENCE_RUN.md for the fillable report) ──",
      "scenarios: Chrome AND Edge × {host + 1 guest, host + 3 guests}, 15–30 min watch each",
      "per session: publish MP4 · play/pause/seek sync · chat · voice · reconnect · room full (5th denied) · submit feedback",
      "network matrix: normal, then UDP-blocked / TURN-only path (record whether media falls back)",
      "after sessions: export feedback via WT-605 and triage blocker/non-blocker reports",
      "watch while running (Prometheus, access is internal-only):",
      "  wt.telemetry.first_frame / wt.telemetry.playback_error  → guest watch success",
      "  wt.telemetry.publish_start / wt.telemetry.publish_failure → host publish success",
      "  wt.telemetry.quality{status} · wt.room.participants.joined · wt.ratelimit.rejected{bucket}",
      "Successful Watch Session Rate = rooms where host published, ≥1 guest saw first frame, watch ≥10 min",
      "capture per session: outcome, first-frame yes/no, watch minutes, quality, issues + blocker/non-blocker",
    ].join("\n"),
  );
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function isLocalhost(url) {
  return (
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "::1"
  );
}

function resolvePath(path) {
  return new URL(path.replace(/^\//, ""), baseUrl).href;
}

async function getText(path) {
  const response = await fetch(resolvePath(path), {
    headers: { Accept: "text/html,application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  };
}

async function getJson(path, headers = {}) {
  const response = await fetch(resolvePath(path), {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: await readJson(response) };
}

async function postJson(path, body) {
  const response = await fetch(resolvePath(path), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: await readJson(response) };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

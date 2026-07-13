#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const DEFAULT_THRESHOLDS = {
  maxFirstFrameP95Ms: 5_000,
  maxRttP95Ms: 250,
  maxJitterP95Ms: 60,
  maxPacketLossP95Percent: 3,
  maxPoorQualityRatio: 0.1,
  maxLostQualitySeconds: 0,
  maxReconnects: 0,
  maxRoomEgressGbPerHour: 6,
  maxRoomCostUsdPerHour: 1,
  maxHostCpuP95Percent: 85,
  maxHostMemoryMbP95: 4_096,
  maxLiveKitCpuP95Percent: 75,
  maxLiveKitMemoryMbP95: 2_048,
};

const DEFAULT_PRICING = {
  liveKitEgressUsdPerGb: 0,
  turnEgressUsdPerGb: 0,
};

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--template")) {
  console.log(JSON.stringify(template(), null, 2));
  process.exit(0);
}

const inputPath = args.find((arg) => arg === "-" || !arg.startsWith("-"));
if (!inputPath) {
  printHelp();
  process.exit(1);
}

const report = JSON.parse(await readInput(inputPath));
const summary = summarize(report);
console.log(renderMarkdown(summary));

async function readInput(path) {
  if (path === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  return readFile(path, "utf8");
}

function summarize(report) {
  const sessions = Array.isArray(report.sessions) ? report.sessions : [];
  if (sessions.length === 0) {
    throw new Error("WT-607 report must contain a non-empty sessions array");
  }

  const pricing = {
    ...DEFAULT_PRICING,
    ...(report.pricing ?? {}),
  };
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(report.thresholds ?? {}),
  };

  const sessionSummaries = sessions.map((session, index) =>
    summarizeSession(session, index, pricing, thresholds),
  );
  const totalDurationHours = sum(sessionSummaries, "durationHours");
  const totalEgressGb = sum(sessionSummaries, "egressGb");
  const totalTurnEgressGb = sum(sessionSummaries, "turnEgressGb");
  const totalCostUsd = sum(sessionSummaries, "estimatedCostUsd");
  const overallSeverity = worstSeverity(
    sessionSummaries.map((session) => session.severity),
  );

  return {
    run: report.run ?? {},
    pricing,
    thresholds,
    sessions: sessionSummaries,
    totals: {
      durationHours: totalDurationHours,
      egressGb: totalEgressGb,
      turnEgressGb: totalTurnEgressGb,
      costUsd: totalCostUsd,
      egressGbPerHour:
        totalDurationHours > 0 ? totalEgressGb / totalDurationHours : 0,
      costUsdPerHour:
        totalDurationHours > 0 ? totalCostUsd / totalDurationHours : 0,
    },
    severity: overallSeverity,
  };
}

function summarizeSession(session, index, pricing, thresholds) {
  const label = session.id ?? `session-${index + 1}`;
  const durationMinutes = number(
    session.durationMinutes,
    `${label}.durationMinutes`,
    {
      minExclusive: 0,
    },
  );
  const guestCount = number(session.guestCount, `${label}.guestCount`, {
    minInclusive: 1,
  });
  const liveKit = session.liveKit ?? {};
  const quality = session.quality ?? {};
  const resources = session.resources ?? {};
  const egressAvgMbps = number(
    liveKit.egressAvgMbps,
    `${label}.liveKit.egressAvgMbps`,
    {
      minInclusive: 0,
    },
  );
  const turnEgressAvgMbps = optionalNumber(
    liveKit.turnEgressAvgMbps,
    `${label}.liveKit.turnEgressAvgMbps`,
    { minInclusive: 0 },
  );
  const durationHours = durationMinutes / 60;
  const egressGb = mbpsToGb(egressAvgMbps, durationMinutes);
  const turnEgressGb = mbpsToGb(turnEgressAvgMbps ?? 0, durationMinutes);
  const liveKitCostUsd =
    egressGb * numberOrDefault(pricing.liveKitEgressUsdPerGb, 0);
  const turnCostUsd =
    turnEgressGb * numberOrDefault(pricing.turnEgressUsdPerGb, 0);
  const estimatedCostUsd = liveKitCostUsd + turnCostUsd;
  const poorQualitySeconds =
    optionalNumber(
      quality.poorQualitySeconds,
      `${label}.quality.poorQualitySeconds`,
      {
        minInclusive: 0,
      },
    ) ?? 0;
  const lostQualitySeconds =
    optionalNumber(
      quality.lostQualitySeconds,
      `${label}.quality.lostQualitySeconds`,
      {
        minInclusive: 0,
      },
    ) ?? 0;
  const poorQualityRatio =
    (poorQualitySeconds + lostQualitySeconds) / (durationMinutes * 60);
  const findings = [
    ...thresholdFindings(
      label,
      "first frame p95",
      quality.firstFrameP95Ms,
      "ms",
      thresholds.maxFirstFrameP95Ms,
    ),
    ...thresholdFindings(
      label,
      "RTT p95",
      quality.rttP95Ms,
      "ms",
      thresholds.maxRttP95Ms,
    ),
    ...thresholdFindings(
      label,
      "jitter p95",
      quality.jitterP95Ms,
      "ms",
      thresholds.maxJitterP95Ms,
    ),
    ...thresholdFindings(
      label,
      "packet loss p95",
      quality.packetLossP95Percent,
      "%",
      thresholds.maxPacketLossP95Percent,
    ),
    ...thresholdFindings(
      label,
      "poor/lost quality ratio",
      poorQualityRatio,
      "ratio",
      thresholds.maxPoorQualityRatio,
    ),
    ...thresholdFindings(
      label,
      "lost quality seconds",
      lostQualitySeconds,
      "s",
      thresholds.maxLostQualitySeconds,
    ),
    ...thresholdFindings(
      label,
      "reconnects",
      quality.reconnects,
      "count",
      thresholds.maxReconnects,
    ),
    ...thresholdFindings(
      label,
      "room egress GB/hour",
      durationHours > 0 ? egressGb / durationHours : 0,
      "GB/h",
      thresholds.maxRoomEgressGbPerHour,
    ),
    ...costFindings(
      label,
      durationHours > 0 ? estimatedCostUsd / durationHours : 0,
      thresholds.maxRoomCostUsdPerHour,
      pricing,
    ),
    ...thresholdFindings(
      label,
      "host CPU p95",
      resources.hostCpuP95Percent,
      "%",
      thresholds.maxHostCpuP95Percent,
    ),
    ...thresholdFindings(
      label,
      "host memory p95",
      resources.hostMemoryMbP95,
      "MB",
      thresholds.maxHostMemoryMbP95,
    ),
    ...thresholdFindings(
      label,
      "LiveKit CPU p95",
      resources.liveKitCpuP95Percent,
      "%",
      thresholds.maxLiveKitCpuP95Percent,
    ),
    ...thresholdFindings(
      label,
      "LiveKit memory p95",
      resources.liveKitMemoryMbP95,
      "MB",
      thresholds.maxLiveKitMemoryMbP95,
    ),
    ...mediaPathFindings(session),
  ];

  const severity = worstSeverity(findings.map((finding) => finding.severity));

  return {
    label,
    browser: session.browser ?? "-",
    networkProfile: session.networkProfile ?? "-",
    mediaPath: session.mediaPath ?? "-",
    guestCount,
    durationMinutes,
    durationHours,
    egressAvgMbps,
    turnEgressAvgMbps: turnEgressAvgMbps ?? 0,
    egressGb,
    turnEgressGb,
    estimatedCostUsd,
    egressGbPerHour: durationHours > 0 ? egressGb / durationHours : 0,
    costUsdPerHour: durationHours > 0 ? estimatedCostUsd / durationHours : 0,
    firstFrameP95Ms: optionalNumber(
      quality.firstFrameP95Ms,
      `${label}.quality.firstFrameP95Ms`,
    ),
    rttP95Ms: optionalNumber(quality.rttP95Ms, `${label}.quality.rttP95Ms`),
    jitterP95Ms: optionalNumber(
      quality.jitterP95Ms,
      `${label}.quality.jitterP95Ms`,
    ),
    packetLossP95Percent: optionalNumber(
      quality.packetLossP95Percent,
      `${label}.quality.packetLossP95Percent`,
    ),
    poorQualityRatio,
    liveKitCpuP95Percent: optionalNumber(
      resources.liveKitCpuP95Percent,
      `${label}.resources.liveKitCpuP95Percent`,
    ),
    liveKitMemoryMbP95: optionalNumber(
      resources.liveKitMemoryMbP95,
      `${label}.resources.liveKitMemoryMbP95`,
    ),
    severity,
    findings,
  };
}

function thresholdFindings(label, metric, value, unit, threshold) {
  if (
    value === undefined ||
    value === null ||
    threshold === undefined ||
    threshold === null
  ) {
    return [];
  }

  const actual = number(value, `${label}.${metric}`);
  const limit = number(threshold, `thresholds.${metric}`);
  if (actual <= limit) {
    return [];
  }

  return [
    {
      severity: "FAIL",
      message: `${label}: ${metric} ${formatMetric(actual, unit)} > ${formatMetric(limit, unit)}`,
    },
  ];
}

function costFindings(label, costUsdPerHour, threshold, pricing) {
  const hasPricing =
    numberOrDefault(pricing.liveKitEgressUsdPerGb, 0) > 0 ||
    numberOrDefault(pricing.turnEgressUsdPerGb, 0) > 0;
  if (!hasPricing) {
    return [
      {
        severity: "WARN",
        message: `${label}: pricing is not configured, cost verdict skipped`,
      },
    ];
  }

  return thresholdFindings(
    label,
    "room cost USD/hour",
    costUsdPerHour,
    "$/h",
    threshold,
  );
}

function mediaPathFindings(session) {
  const path = String(session.mediaPath ?? "").toLowerCase();
  const network = String(session.networkProfile ?? "").toLowerCase();
  const expectedFallback = network.includes("turn") || network.includes("udp");

  if ((path.includes("turn") || path.includes("tcp")) && !expectedFallback) {
    return [
      {
        severity: "WARN",
        message: `${session.id ?? "session"}: fallback media path on non-fallback profile (${session.mediaPath})`,
      },
    ];
  }

  return [];
}

function renderMarkdown(summary) {
  const runTitle = summary.run.name ?? "WT-607 media QoS/cost summary";
  const lines = [
    `# ${runTitle}`,
    "",
    `Verdict: **${summary.severity}**`,
    "",
    "## Run",
    "",
    `- Date: ${summary.run.date ?? "-"}`,
    `- Base URL: ${summary.run.baseUrl ?? "-"}`,
    `- Commit: ${summary.run.commit ?? "-"}`,
    `- Fixture: ${summary.run.fixture ?? "-"}`,
    "",
    "## Totals",
    "",
    `- Measured duration: ${formatNumber(summary.totals.durationHours, 2)} h`,
    `- LiveKit egress: ${formatNumber(summary.totals.egressGb, 3)} GB (${formatNumber(summary.totals.egressGbPerHour, 3)} GB/h)`,
    `- TURN egress subset: ${formatNumber(summary.totals.turnEgressGb, 3)} GB`,
    `- Estimated media cost: $${formatNumber(summary.totals.costUsd, 4)} ($${formatNumber(summary.totals.costUsdPerHour, 4)}/h)`,
    "",
    "## Sessions",
    "",
    [
      "| ID | Browser | Guests | Network | Path | Min | Egress GB/h | Cost $/h | First frame p95 | RTT p95 | Loss p95 | Poor/lost | LK CPU p95 | Verdict |",
      "| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
      ...summary.sessions.map(
        (session) =>
          `| ${[
            session.label,
            session.browser,
            session.guestCount,
            session.networkProfile,
            session.mediaPath,
            formatNumber(session.durationMinutes, 0),
            formatNumber(session.egressGbPerHour, 3),
            formatNumber(session.costUsdPerHour, 4),
            formatNullable(session.firstFrameP95Ms, "ms"),
            formatNullable(session.rttP95Ms, "ms"),
            formatNullable(session.packetLossP95Percent, "%"),
            formatNumber(session.poorQualityRatio * 100, 1) + "%",
            formatNullable(session.liveKitCpuP95Percent, "%"),
            session.severity,
          ].join(" | ")} |`,
      ),
    ].join("\n"),
    "",
    "## Findings",
    "",
  ];

  const findings = summary.sessions.flatMap((session) => session.findings);
  if (findings.length === 0) {
    lines.push("- No threshold violations.");
  } else {
    for (const finding of findings) {
      lines.push(`- [${finding.severity}] ${finding.message}`);
    }
  }

  return lines.join("\n");
}

function worstSeverity(values) {
  if (values.includes("FAIL")) {
    return "FAIL";
  }
  if (values.includes("WARN")) {
    return "WARN";
  }
  return "PASS";
}

function mbpsToGb(mbps, minutes) {
  return (mbps * minutes * 60) / 8 / 1_000;
}

function sum(items, field) {
  return items.reduce((total, item) => total + item[field], 0);
}

function number(value, label, options = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (options.minExclusive !== undefined && value <= options.minExclusive) {
    throw new Error(`${label} must be > ${options.minExclusive}`);
  }
  if (options.minInclusive !== undefined && value < options.minInclusive) {
    throw new Error(`${label} must be >= ${options.minInclusive}`);
  }

  return value;
}

function optionalNumber(value, label, options = {}) {
  if (value === undefined || value === null) {
    return null;
  }

  return number(value, label, options);
}

function numberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatNullable(value, unit) {
  return value === null || value === undefined
    ? "-"
    : formatMetric(value, unit);
}

function formatMetric(value, unit) {
  if (unit === "ratio") {
    return `${formatNumber(value * 100, 1)}%`;
  }
  if (unit === "$/h") {
    return `$${formatNumber(value, 4)}/h`;
  }

  return `${formatNumber(value, unit === "%" ? 2 : 0)} ${unit}`;
}

function formatNumber(value, digits) {
  return Number(value).toFixed(digits);
}

function printHelp() {
  console.log(`Usage:
  node scripts/media-qos-cost-summary.mjs --template
  node scripts/media-qos-cost-summary.mjs <report.json>
  node scripts/media-qos-cost-summary.mjs - < report.json

Reads a WT-607 media QoS/cost JSON report and prints a markdown summary with PASS/WARN/FAIL findings.`);
}

function template() {
  return {
    run: {
      name: "WT-607 media QoS benchmark — staging YYYY-MM-DD",
      date: "YYYY-MM-DD",
      baseUrl: "https://beta.example.com",
      commit: "<git-sha>",
      fixture: "1080p H.264/AAC MP4, 15-30 min",
      operator: "<name>",
    },
    pricing: {
      liveKitEgressUsdPerGb: 0.09,
      turnEgressUsdPerGb: 0.09,
    },
    thresholds: DEFAULT_THRESHOLDS,
    sessions: [
      {
        id: "chrome-host-3-normal",
        browser: "Chrome",
        networkProfile: "normal",
        mediaPath: "direct-udp",
        guestCount: 3,
        durationMinutes: 30,
        liveKit: {
          ingressAvgMbps: 3.2,
          egressAvgMbps: 9.6,
          turnEgressAvgMbps: 0,
        },
        quality: {
          firstFrameP95Ms: 1800,
          rttP95Ms: 90,
          jitterP95Ms: 18,
          packetLossP95Percent: 0.4,
          poorQualitySeconds: 12,
          lostQualitySeconds: 0,
          reconnects: 0,
        },
        resources: {
          hostCpuP95Percent: 55,
          hostMemoryMbP95: 1200,
          liveKitCpuP95Percent: 35,
          liveKitMemoryMbP95: 900,
        },
        notes: "Заполнить после ручного прогона.",
      },
    ],
  };
}

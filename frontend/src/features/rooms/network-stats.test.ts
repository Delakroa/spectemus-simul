import { computeNetworkStats } from "./network-stats";

describe("computeNetworkStats", () => {
  it("download: собирает inbound-rtp метрики и RTT из candidate-pair", () => {
    const { stats, sample } = computeNetworkStats(
      [
        {
          type: "inbound-rtp",
          bytesReceived: 100_000,
          packetsReceived: 900,
          packetsLost: 100,
          jitter: 0.02,
          timestamp: 10_000,
        },
        { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.05 },
      ],
      "down",
      null,
    );

    expect(stats.direction).toBe("down");
    expect(stats.jitterMs).toBe(20);
    expect(stats.rttMs).toBe(50);
    expect(stats.packetLoss).toBeCloseTo(0.1, 5); // 100 / (900 + 100)
    expect(stats.bitrateKbps).toBeNull(); // первый сэмпл — дельты нет
    expect(sample).toEqual({
      timestamp: 10_000,
      bytes: 100_000,
      packets: 900,
      packetsLost: 100,
    });
  });

  it("вычисляет битрейт и интервальные потери по дельте от предыдущего сэмпла", () => {
    const previous = { timestamp: 10_000, bytes: 100_000, packets: 900, packetsLost: 100 };
    const { stats } = computeNetworkStats(
      [
        {
          type: "inbound-rtp",
          bytesReceived: 200_000,
          packetsReceived: 1_900,
          packetsLost: 110,
          jitter: 0.01,
          timestamp: 11_000,
        },
      ],
      "down",
      previous,
    );

    // dt = 1s, bytesDelta = 100_000 → 100000 * 8 / 1000 = 800 kbps
    expect(stats.bitrateKbps).toBe(800);
    // lostDelta = 10, packetsDelta = 1000 → 10 / 1010
    expect(stats.packetLoss).toBeCloseTo(10 / 1010, 5);
  });

  it("upload: RTT/jitter/loss из remote-inbound-rtp, байты из outbound-rtp", () => {
    const { stats } = computeNetworkStats(
      [
        { type: "outbound-rtp", bytesSent: 50_000, packetsSent: 500, timestamp: 5_000 },
        { type: "remote-inbound-rtp", packetsLost: 25, jitter: 0.03, roundTripTime: 0.12 },
      ],
      "up",
      null,
    );

    expect(stats.rttMs).toBe(120);
    expect(stats.jitterMs).toBe(30);
    expect(stats.packetLoss).toBeCloseTo(25 / 525, 5); // 25 / (500 + 25)
  });

  it("без rtp-статов отдаёт пустые метрики, но берёт RTT из candidate-pair", () => {
    const { stats } = computeNetworkStats(
      [{ type: "candidate-pair", nominated: true, currentRoundTripTime: 0.04 }],
      "down",
      null,
    );

    expect(stats.rttMs).toBe(40);
    expect(stats.jitterMs).toBeNull();
    expect(stats.packetLoss).toBe(0);
    expect(stats.bitrateKbps).toBeNull();
  });
});

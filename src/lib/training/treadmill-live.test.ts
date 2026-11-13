import { describe, expect, it } from "vitest";
import {
  advanceIfDue,
  lapsFromSegments,
  newLive,
  nextLap,
  pause,
  segmentsAt,
  setBelt,
  start,
  overlapShare,
  plannedKmh,
  stepKmh,
  stepRemaining,
  totals,
  withHeartRate,
  type LiveStep,
  type Segment,
} from "./treadmill-live";

const t0 = Date.UTC(2026, 10, 13, 6, 0, 0);
const seg = (fromSec: number, toSec: number, kmh: number, lap: number, inclinePct = 1): Segment => ({
  startMs: t0 + fromSec * 1000,
  endMs: t0 + toSec * 1000,
  kmh,
  inclinePct,
  lap,
});

describe("live treadmill session", () => {
  it("turns a pace target into a belt speed", () => {
    const kmh = stepKmh({ kind: "work", duration: { type: "time", value: 480 }, target: { type: "pace", zone: "T", low: 266, high: 274 }, note: null });
    expect(kmh).toEqual([13.1, 13.5]);
    const step: LiveStep = { kind: "work", label: "Work", duration: { type: "time", value: 480 }, kmh, target: null, note: null };
    expect(plannedKmh(step)).toBe(13.3);
    expect(plannedKmh({ ...step, kmh: null })).toBeNull();
  });

  it("builds laps from speed changes and skips pauses", () => {
    // Lap 0: 5 min at 10 km/h, pause 1 min, 5 min at 11 km/h at 2 %. Lap 1: 2 min at 15 km/h.
    const segments = [seg(0, 300, 10, 0, 0), seg(360, 660, 11, 0, 2), seg(660, 780, 15, 1)];
    const laps = lapsFromSegments(segments);
    expect(laps).toHaveLength(2);
    expect(laps[0]).toMatchObject({ durationSec: 600, distanceM: 1750, inclinePct: 1 });
    expect(laps[1]).toMatchObject({ durationSec: 120, distanceM: 500 });
    expect(totals(segments).sec).toBe(720);
    expect(Math.round(totals(segments, 1).m)).toBe(500);
  });

  it("adds the watch's heart rate to each lap", () => {
    const laps = lapsFromSegments([seg(0, 60, 10, 0), seg(60, 120, 15, 1)]);
    const hr: [number, number][] = [
      [t0 + 10_000, 130],
      [t0 + 50_000, 140],
      [t0 + 90_000, 170],
    ];
    expect(withHeartRate(laps, hr).map((l) => l.avgHr)).toEqual([135, 170]);
  });

  it("counts down time and distance steps", () => {
    const base = { kind: "work" as const, label: "Work", kmh: null, target: null, note: null };
    expect(stepRemaining({ ...base, duration: { type: "time", value: 480 } }, 100, 0)).toEqual({ unit: "sec", value: 380 });
    expect(stepRemaining({ ...base, duration: { type: "distance", value: 800 } }, 100, 300)).toEqual({ unit: "m", value: 500 });
    expect(stepRemaining({ ...base, duration: { type: "open", value: null } }, 100, 300)).toBeNull();
    expect(stepRemaining(undefined, 0, 0)).toBeNull();
  });

  it("measures how far two runs overlap", () => {
    expect(overlapShare([0, 100], [10, 90])).toBe(1);
    expect(overlapShare([0, 100], [50, 250])).toBe(0.5);
    expect(overlapShare([0, 100], [200, 300])).toBe(0);
  });
});

describe("live treadmill state", () => {
  const step = (sec: number, kmh: [number, number] | null): LiveStep => ({
    kind: "work",
    label: "Work",
    duration: { type: "time", value: sec },
    kmh,
    target: null,
    note: null,
  });
  const steps = [step(60, [10, 10]), step(30, [15, 15.4]), step(60, null)];

  it("runs a planned workout step by step and keeps the athlete's own changes", () => {
    let s = start(newLive("w", "Test", 10), t0);
    s = advanceIfDue(s, t0 + 30_000, steps);
    expect(s.lap).toBe(0);
    s = advanceIfDue(s, t0 + 60_000, steps);
    expect(s).toMatchObject({ lap: 1, kmh: 15.2 });
    // Running faster than planned for this rep
    s = setBelt(s, t0 + 70_000, { kmh: 15.5 });
    s = advanceIfDue(s, t0 + 90_000, steps);
    // No planned speed for the last step, so the belt stays where it was
    expect(s).toMatchObject({ lap: 2, kmh: 15.5 });
    const laps = lapsFromSegments(segmentsAt(pause(s, t0 + 150_000), t0 + 150_000));
    expect(laps.map((l) => l.durationSec)).toEqual([60, 30, 60]);
    expect(laps[1].distanceM).toBe(Math.round((15.2 / 3.6) * 10 + (15.5 / 3.6) * 20));
  });

  it("folds quick taps into one segment and does not count pauses", () => {
    let s = start(newLive(null, "Run", 10), t0);
    s = setBelt(s, t0 + 500, { kmh: 10.1 });
    s = setBelt(s, t0 + 900, { kmh: 10.2 });
    s = pause(s, t0 + 60_000);
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0].kmh).toBe(10.2);
    s = start(s, t0 + 120_000);
    expect(totals(segmentsAt(s, t0 + 180_000)).sec).toBe(120);
    expect(nextLap(s, t0 + 180_000, []).lap).toBe(1);
  });
});

describe("live treadmill catch-up", () => {
  it("ends steps exactly on time, even several at once after the screen was locked", () => {
    const steps: LiveStep[] = [60, 30, 60].map((sec, i) => ({
      kind: "work",
      label: "Work",
      duration: { type: "time", value: sec },
      kmh: i === 1 ? [15, 15] : [10, 10],
      target: null,
      note: null,
    }));
    const s = advanceIfDue(start(newLive("w", "Test", 10), t0), t0 + 100_000, steps);
    expect(s.lap).toBe(2);
    expect(lapsFromSegments(segmentsAt(s, t0 + 100_000)).map((l) => l.durationSec)).toEqual([60, 30, 10]);
  });
});

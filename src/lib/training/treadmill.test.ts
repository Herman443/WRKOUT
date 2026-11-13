import { describe, expect, it } from "vitest";
import { computeCompliance } from "./compliance";
import type { PlannedLite } from "./planned";
import { averageIncline, climbM, equivalentFlatDistance, formatKmh, isTreadmill, kmhFromPace, lapsFromBelt, paceTrusted, scaleLaps } from "./treadmill";

describe("treadmill", () => {
  it("recognises treadmill activity types", () => {
    expect(isTreadmill("treadmill_running")).toBe(true);
    expect(isTreadmill("indoor_running")).toBe(true);
    expect(isTreadmill("running")).toBe(false);
    expect(isTreadmill(null)).toBe(false);
    expect(paceTrusted({ subSport: "treadmill_running", extra: {} })).toBe(false);
    expect(paceTrusted({ subSport: "treadmill_running", extra: { treadmill: { method: "distance" } } })).toBe(true);
    expect(paceTrusted({ subSport: "running", extra: {} })).toBe(true);
  });

  it("converts pace to belt speed", () => {
    expect(formatKmh(kmhFromPace(240))).toBe("15.0"); // 4:00/km
    expect(formatKmh(kmhFromPace(255))).toBe("14.1"); // 4:15/km
  });

  it("scales laps to the treadmill's distance", () => {
    const laps = scaleLaps([{ durationSec: 600, distanceM: 1800 }, { durationSec: 600, distanceM: 2200 }], 4400, 1);
    expect(laps.map((l) => l.distanceM)).toEqual([1980, 2420]);
    expect(laps.every((l) => l.inclinePct === 1)).toBe(true);
    expect(scaleLaps([{ durationSec: 300, distanceM: 0 }, { durationSec: 100, distanceM: 0 }], 2000, null).map((l) => l.distanceM)).toEqual([1500, 500]);
  });

  it("rebuilds laps from belt speed and incline", () => {
    const laps = lapsFromBelt(
      [{ durationSec: 240, distanceM: 900 }, { durationSec: 120, distanceM: 300 }, { durationSec: 60, distanceM: 150 }],
      [{ kmh: 15, inclinePct: 1 }, { kmh: 9, inclinePct: null }, { kmh: null, inclinePct: null }],
    );
    expect(laps.map((l) => l.distanceM)).toEqual([1000, 300, 150]);
    expect(laps[0].inclinePct).toBe(1);
    expect(averageIncline(laps)).toBe(1);
  });

  it("counts incline as extra effort and climb", () => {
    const flat = [{ durationSec: 600, distanceM: 2000, inclinePct: 0 }];
    const hill = [{ durationSec: 600, distanceM: 2000, inclinePct: 5 }];
    expect(equivalentFlatDistance(flat)).toBe(2000);
    expect(equivalentFlatDistance(hill)).toBeCloseTo(2450);
    expect(climbM(hill)).toBeCloseTo(100);
  });

  it("does not score pace targets from an uncorrected treadmill run", () => {
    const planned: PlannedLite = {
      id: "t",
      date: "2026-11-12",
      sport: "run",
      type: "threshold",
      title: "3 × 10 min",
      key: true,
      plannedDurationSec: 1800,
      plannedDistanceM: null,
      status: "planned",
      structure: [
        { kind: "repeat", times: 3, steps: [{ kind: "work", duration: { type: "time", value: 600 }, target: { type: "pace", zone: "T", low: 250, high: 260 }, note: null }] },
      ],
    };
    const laps = Array.from({ length: 3 }, () => ({ durationSec: 600, distanceM: 2000 })); // 5:00/km by the watch
    const guessed = computeCompliance(planned, { durationSec: 1800, distanceM: 6000, laps, paceTrusted: false });
    expect(guessed.intensity).toBeNull();
    expect(guessed.notes.join()).toMatch(/Treadmill/);
    const corrected = computeCompliance(planned, { durationSec: 1800, distanceM: 7080, laps: scaleLaps(laps, 7080, 1) });
    expect(corrected.intensity).toBe(100);
  });
});

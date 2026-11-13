import { describe, expect, it } from "vitest";
import { mapActivitySummary, sportFromGarmin } from "../garmin/map";
import { silhouetteBars } from "./intensity";
import { estimateWorkoutLoad } from "./load";
import type { Step } from "./workout-structure";

const none = { type: "none" as const, zone: null, low: null, high: null };

describe("silhouette", () => {
  it("expands repeats and ranks intensity", () => {
    const steps: Step[] = [
      { kind: "warmup", duration: { type: "time", value: 600 }, target: { type: "pace", zone: "Easy", low: 320, high: 350 }, note: null },
      {
        kind: "repeat",
        times: 3,
        steps: [
          { kind: "work", duration: { type: "distance", value: 1000 }, target: { type: "pace", zone: "Threshold", low: 250, high: 258 }, note: null },
          { kind: "recovery", duration: { type: "time", value: 60 }, target: none, note: null },
        ],
      },
    ];
    const bars = silhouetteBars(steps, "threshold", null);
    expect(bars).toHaveLength(7);
    expect(bars[0].level).toBe(2);
    expect(bars[1]).toMatchObject({ level: 4, seconds: 254 });
    expect(bars[2].level).toBe(1);
  });
  it("falls back to one bar for unstructured sessions", () => {
    expect(silhouetteBars([], "long", 5400)).toEqual([{ level: 2, seconds: 5400 }]);
  });
});

describe("planned load", () => {
  it("scores an hour of threshold work above an hour easy", () => {
    const easy = estimateWorkoutLoad([{ kind: "work", durationSec: 3600, zone: "Easy" }], "easy", 3600);
    const hard = estimateWorkoutLoad([{ kind: "work", durationSec: 3600, zone: "Threshold" }], "threshold", 3600);
    expect(easy).toBe(49);
    expect(hard).toBeGreaterThan(90);
  });
});

describe("garmin mapping", () => {
  it("maps activity types to sports", () => {
    expect(sportFromGarmin("trail_running")).toBe("run");
    expect(sportFromGarmin("virtual_ride")).toBe("bike");
    expect(sportFromGarmin("road_biking")).toBe("bike");
    expect(sportFromGarmin("lap_swimming")).toBe("swim");
    expect(sportFromGarmin("strength_training")).toBe("strength");
    expect(sportFromGarmin("yoga")).toBe("other");
  });
  it("reads GMT start times and zone seconds", () => {
    const m = mapActivitySummary({
      activityId: 123,
      activityName: "Evening run",
      startTimeGMT: "2026-11-12 22:30:00",
      activityType: { typeKey: "running" },
      duration: 1800,
      distance: 5000,
      hrTimeInZone_1: 60,
      hrTimeInZone_2: 1500,
    });
    expect(m.startTime.toISOString()).toBe("2026-11-12T22:30:00.000Z");
    expect(m.localDate).toBe("2026-11-12"); // 23:30 in Oslo
    expect(m.hrZoneSeconds).toEqual([60, 1500, 0, 0, 0]);
    expect(m.sport).toBe("run");
  });
});

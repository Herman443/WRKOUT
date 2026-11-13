import { describe, expect, it } from "vitest";
import { addDays, diffDays, startOfWeek, weekday } from "../dates";
import { classifyChanges } from "./changes";
import { computeCompliance } from "./compliance";
import { checkOutline, checkWeek } from "./guardrails";
import { acwr, activityLoad, fitnessSeries } from "./load";
import { matchActivity } from "./matching";
import type { WeekOutline } from "./plan";
import type { PlannedLite, PlannedWorkoutInput } from "./planned";
import { predictRaceTime, trainingPaces, vdotFromRace, vdotFromEasyPace } from "./vdot";
import { hrZonesFromLthr, powerZones } from "./zones";
import { structureTotals, type Step } from "./workout-structure";

describe("dates", () => {
  it("does calendar arithmetic across DST", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(diffDays("2026-10-24", "2026-10-26")).toBe(2);
    expect(weekday("2026-11-16")).toBe(0); // Monday
    expect(startOfWeek("2026-11-22")).toBe("2026-11-16");
  });
});

describe("VDOT (vs Daniels' tables)", () => {
  it("rates a 19:57 5K at ~VDOT 50", () => {
    expect(vdotFromRace(5000, 19 * 60 + 57)).toBeCloseTo(50, 0);
  });
  it("predicts race times for VDOT 50", () => {
    expect(Math.abs(predictRaceTime(50, 42195) - (3 * 3600 + 10 * 60 + 49))).toBeLessThan(90);
    expect(Math.abs(predictRaceTime(50, 10000) - (41 * 60 + 21))).toBeLessThan(20);
  });
  it("derives training paces", () => {
    const p50 = trainingPaces(50);
    expect(Math.abs(p50.threshold - 255)).toBeLessThan(4); // 4:15/km
    expect(Math.abs(p50.interval - 235)).toBeLessThan(4); // 3:55/km
    expect(Math.abs(p50.marathon - 271)).toBeLessThan(4); // 4:31/km
    expect(p50.easy[0]).toBeLessThan(p50.easy[1]);
    expect(p50.repetition).toBeLessThan(p50.interval);
    expect(Math.abs(trainingPaces(40).threshold - 306)).toBeLessThan(4); // 5:06/km
  });
  it("estimates VDOT from easy pace", () => {
    expect(vdotFromEasyPace(330)).toBeGreaterThan(42);
    expect(vdotFromEasyPace(330)).toBeLessThan(52);
  });
});

describe("zones", () => {
  it("computes Coggan power zones", () => {
    const z = powerZones(250);
    expect(z[1]).toMatchObject({ low: 140, high: 188 });
    expect(z[4]).toMatchObject({ low: 238, high: 263 });
  });
  it("computes Friel run HR zones", () => {
    const z = hrZonesFromLthr(170);
    expect(z[1].low).toBe(145);
    expect(z[3].high).toBe(169);
  });
});

describe("load", () => {
  it("scores an hour at threshold as 100", () => {
    expect(activityLoad({ sport: "bike", durationSec: 3600, normalizedPower: 250 }, { ftp: 250 }).value).toBe(100);
    expect(
      activityLoad({ sport: "run", durationSec: 3600, distanceM: 14118 }, { thresholdPaceSecPerKm: 255 }).value,
    ).toBeCloseTo(100, -1);
    expect(
      activityLoad({ sport: "run", durationSec: 3600, avgHr: 170 }, { lthr: 170, maxHr: 190, restingHr: 50 }).value,
    ).toBe(100);
  });
  it("converges CTL to a steady daily load", () => {
    const start = "2026-01-01";
    const end = addDays(start, 300);
    const loads = Array.from({ length: 301 }, (_, i) => ({ date: addDays(start, i), load: 80 }));
    const last = fitnessSeries(loads, start, end).at(-1)!;
    expect(last.ctl).toBeCloseTo(80, 0);
    expect(last.atl).toBeCloseTo(80, 0);
    expect(acwr(loads, end)).toBe(1);
  });
});

const easyStep: Step = {
  kind: "work",
  duration: { type: "time", value: 2700 },
  target: { type: "pace", zone: "Easy", low: 320, high: 350 },
  note: null,
};

const intervals: Step[] = [
  { kind: "warmup", duration: { type: "time", value: 900 }, target: { type: "none", zone: null, low: null, high: null }, note: null },
  {
    kind: "repeat",
    times: 5,
    steps: [
      { kind: "work", duration: { type: "distance", value: 1000 }, target: { type: "pace", zone: "Interval", low: 232, high: 238 }, note: null },
      { kind: "recovery", duration: { type: "time", value: 120 }, target: { type: "none", zone: null, low: null, high: null }, note: null },
    ],
  },
  { kind: "cooldown", duration: { type: "time", value: 600 }, target: { type: "none", zone: null, low: null, high: null }, note: null },
];

function planned(over: Partial<PlannedLite>): PlannedLite {
  return {
    id: "w1",
    date: "2026-11-16",
    sport: "run",
    type: "easy",
    title: "Easy run",
    key: false,
    plannedDurationSec: 2700,
    plannedDistanceM: null,
    structure: [easyStep],
    status: "planned",
    ...over,
  };
}

describe("workout structure", () => {
  it("totals repeats", () => {
    const t = structureTotals(intervals, 330);
    expect(t.durationSec).toBe(900 + 5 * (235 + 120) + 600);
  });
});

describe("matching", () => {
  const candidates = [
    planned({ id: "a", date: "2026-11-16", plannedDurationSec: 2700 }),
    planned({ id: "b", date: "2026-11-16", type: "long", plannedDurationSec: 6000 }),
    planned({ id: "c", date: "2026-11-16", sport: "bike", plannedDurationSec: 3600 }),
  ];
  it("prefers same sport and closest duration", () => {
    expect(matchActivity({ sport: "run", date: "2026-11-16", durationSec: 5800 }, candidates)?.id).toBe("b");
    expect(matchActivity({ sport: "run", date: "2026-11-17", durationSec: 2600 }, candidates)?.id).toBe("a");
    expect(matchActivity({ sport: "bike", date: "2026-11-16", durationSec: 3500 }, candidates)?.id).toBe("c");
  });
  it("returns null when nothing is close", () => {
    expect(matchActivity({ sport: "run", date: "2026-11-20", durationSec: 2700 }, candidates)).toBeNull();
    expect(matchActivity({ sport: "swim", date: "2026-11-16", durationSec: 2700 }, candidates)).toBeNull();
  });
});

describe("compliance", () => {
  it("rewards an easy run kept easy", () => {
    const c = computeCompliance(planned({}), { durationSec: 2750, distanceM: 8200, laps: [], hrZoneSeconds: [600, 1900, 200, 50, 0] });
    expect(c.volume).toBe(100);
    expect(c.intensity).toBe(100);
  });
  it("penalises a short, hard easy run", () => {
    const c = computeCompliance(planned({}), { durationSec: 1350, distanceM: 4500, laps: [], hrZoneSeconds: [0, 300, 700, 350, 0] });
    expect(c.volume).toBe(20);
    expect(c.score).toBeLessThan(30);
    expect(c.notes.length).toBeGreaterThan(0);
  });
  it("checks interval laps against the target band", () => {
    const w = planned({ type: "intervals", structure: intervals, plannedDurationSec: 3275 });
    const laps = [
      { durationSec: 900, distanceM: 2700 },
      ...Array.from({ length: 5 }, () => [
        { durationSec: 236, distanceM: 1000 },
        { durationSec: 120, distanceM: 300 },
      ]).flat(),
      { durationSec: 600, distanceM: 1700 },
    ];
    const c = computeCompliance(w, { durationSec: 3280, distanceM: 10400, laps });
    expect(c.intensity).toBe(100);
  });
});

function outline(hours: number[], deloads: number[] = [], startDate = "2026-11-16"): WeekOutline[] {
  return hours.map((h, i) => ({
    index: i,
    startDate: addDays(startDate, i * 7),
    phase: i === hours.length - 1 ? "race" : i >= hours.length - 3 ? "taper" : "build",
    isDeload: deloads.includes(i),
    targetHours: h,
    targetRunKm: null,
    targetBikeHours: null,
    focus: "",
    keySessions: [],
  }));
}

describe("guardrails: outline", () => {
  const race = { sport: "run" as const, distanceM: 21097 };
  it("accepts a sensible plan", () => {
    const r = checkOutline(outline([5, 5.5, 6, 4.5, 6.3, 6.8, 7.2, 5, 7.5, 6, 4], [3, 7]), race);
    expect(r.errors).toEqual([]);
  });
  it("flags aggressive ramps", () => {
    const r = checkOutline(outline([5, 7, 7.5, 5, 7, 6, 4]), race);
    expect(r.errors.some((e) => e.includes("jumps"))).toBe(true);
  });
  it("flags missing deloads", () => {
    const r = checkOutline(outline([5, 5.4, 5.8, 6.2, 6.6, 7, 7.4, 6, 4]), race);
    expect(r.errors.some((e) => e.includes("deload"))).toBe(true);
  });
  it("requires a taper", () => {
    const r = checkOutline(outline([5, 5.5, 6, 4.5, 6.3, 6.8, 7], [3]), race);
    expect(r.errors.some((e) => e.includes("Race week"))).toBe(true);
  });
});

function input(over: Partial<PlannedWorkoutInput>): PlannedWorkoutInput {
  return {
    date: "2026-11-16",
    sport: "run",
    type: "easy",
    title: "Easy",
    purpose: "",
    description: "",
    key: false,
    plannedDurationSec: 2700,
    plannedDistanceM: null,
    structure: [easyStep],
    ...over,
  };
}

describe("guardrails: week", () => {
  const ctx = { availableDays: [0, 1, 3, 5, 6], targetHours: 4.5 };
  it("accepts a balanced week", () => {
    const week = [
      input({ date: "2026-11-16" }),
      input({ date: "2026-11-17", type: "intervals", key: true, plannedDurationSec: 3600 }),
      input({ date: "2026-11-19", type: "tempo", key: true, plannedDurationSec: 3600 }),
      input({ date: "2026-11-21" }),
      input({ date: "2026-11-22", type: "long", key: true, plannedDurationSec: 5400 }),
    ];
    expect(checkWeek(week, ctx).errors).toEqual([]);
  });
  it("flags back-to-back hard days and unavailable days", () => {
    const week = [
      input({ date: "2026-11-21", type: "threshold" }),
      input({ date: "2026-11-22", type: "long", plannedDurationSec: 5400 }),
      input({ date: "2026-11-18" }),
    ];
    const r = checkWeek(week, ctx);
    expect(r.errors.some((e) => e.includes("consecutive"))).toBe(true);
    expect(r.errors.some((e) => e.includes("unavailable"))).toBe(true);
  });
});

describe("change scope", () => {
  const today = "2026-11-16";
  const current: PlannedLite[] = [
    planned({ id: "e1", date: "2026-11-17" }),
    planned({ id: "k1", date: "2026-11-18", type: "intervals", key: true, title: "Intervals", plannedDurationSec: 3600 }),
    planned({ id: "e2", date: "2026-11-20" }),
    planned({ id: "l1", date: "2026-11-22", type: "long", key: true, title: "Long", plannedDurationSec: 6000 }),
    planned({ id: "f1", date: "2026-11-25" }),
  ];
  it("treats a small easy-run tweak as minor", () => {
    const ops = [{ op: "modify" as const, workoutId: "e1", workout: input({ date: "2026-11-17", plannedDurationSec: 2400 }) }];
    expect(classifyChanges(ops, current, today).scope).toBe("minor");
  });
  it("treats removing a key session as major", () => {
    expect(classifyChanges([{ op: "remove", workoutId: "k1" }], current, today).scope).toBe("major");
  });
  it("treats changes beyond 7 days as major", () => {
    expect(classifyChanges([{ op: "move", workoutId: "f1", newDate: "2026-11-26" }], current, today).scope).toBe("major");
  });
  it("treats big volume changes as major", () => {
    expect(classifyChanges([{ op: "remove", workoutId: "e2" }], current, today).scope).toBe("major");
  });
});

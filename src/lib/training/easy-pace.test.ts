import { describe, expect, it } from "vitest";
import { deriveMarkers } from "../athlete";
import type { AthleteProfile } from "@/db/schema";
import type { Lap } from "./compliance";
import { learnEasyPace, type EasyPaceRun } from "./easy-pace";

const z2 = { low: 135, high: 149 };
/** A lap of `min` minutes at `pace` sec/km and `hr` bpm. */
const lap = (min: number, pace: number, hr: number, inclinePct: number | null = null): Lap => ({
  durationSec: min * 60,
  distanceM: ((min * 60) / pace) * 1000,
  avgHr: hr,
  inclinePct,
});
const run = (laps: Lap[]): EasyPaceRun => ({ laps, activeSec: 0, distanceM: null, avgHr: null });

describe("learned easy pace", () => {
  it("takes the median pace of Z2 laps in easy runs", () => {
    const runs = [
      run([lap(10, 420, 125), lap(10, 410, 140), lap(10, 400, 145)]),
      run([lap(10, 415, 142), lap(10, 405, 146)]),
      run([lap(10, 410, 141), lap(10, 400, 147)]),
    ];
    const l = learnEasyPace(runs, z2)!;
    expect(l.runs).toBe(3);
    expect(l.sampleSec).toBe(60 * 60); // the Z1 warm-up lap is left out
    expect(l.paceSecPerKm).toBe(405);
  });

  it("needs enough runs and Z2 time", () => {
    expect(learnEasyPace([run([lap(40, 400, 140)]), run([lap(40, 400, 140)])], z2)).toBeNull();
    expect(learnEasyPace([1, 2, 3].map(() => run([lap(15, 400, 140)])), z2)).toBeNull();
  });

  it("ignores hard sessions, short laps and implausible paces", () => {
    const easy = [1, 2, 3].map(() => run([lap(25, 400, 140)]));
    const intervals = run([lap(4, 250, 172), lap(3, 480, 145), lap(4, 250, 174), lap(3, 480, 146), lap(4, 250, 175)]);
    const strides = run([lap(25, 400, 140), lap(1, 600, 140)]);
    const glitch = run([lap(10, 900, 140)]);
    expect(learnEasyPace([...easy, intervals, strides, glitch], z2)!.paceSecPerKm).toBe(400);
  });

  it("uses flat-equivalent pace for incline laps", () => {
    const runs = [1, 2, 3].map(() => run([lap(25, 400, 140, 1)]));
    // 1 % incline at 6:40/km on the belt is about 6:23/km on the flat
    expect(learnEasyPace(runs, z2)!.paceSecPerKm).toBe(Math.round(400 / 1.045));
  });

  it("falls back to whole-run averages without laps", () => {
    const runs = [1, 2, 3].map(() => ({ laps: [], activeSec: 1500, distanceM: 3750, avgHr: 140 }));
    expect(learnEasyPace(runs, z2)!.paceSecPerKm).toBe(400);
  });

  it("anchors the easy band and beats the typed zone 2 pace", () => {
    const profile = { zone2PaceSecPerKm: 390, prs: [], lthrRun: 165 } as unknown as AthleteProfile;
    const typed = deriveMarkers(profile);
    expect(typed.zones.runPaces!.easy[0]).toBe(390);
    expect(typed.easyPaceSource).toBe("zone 2 pace");
    const learned = deriveMarkers(profile, { paceSecPerKm: 420, runs: 4, sampleSec: 7200 });
    expect(learned.zones.runPaces!.easy[0]).toBe(420);
    expect(learned.easyPaceSource).toBe("recent runs");
    expect(learned.vdot).toBe(typed.vdot); // VDOT, and so the faster paces, are unchanged
  });
});

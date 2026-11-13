import type { PlannedLite } from "./planned";
import { flattenSteps, QUALITY_TYPES } from "./workout-structure";

export interface Lap {
  durationSec: number;
  distanceM: number;
  avgHr?: number | null;
  avgPower?: number | null;
}

export interface ActivityForCompliance {
  durationSec: number;
  distanceM: number | null;
  laps: Lap[];
  /** Seconds in HR zones Z1..Z5 */
  hrZoneSeconds?: number[] | null;
}

export interface Compliance {
  score: number;
  volume: number;
  intensity: number | null;
  notes: string[];
}

const EASY_TYPES = new Set(["easy", "recovery", "long", "endurance", "strides"]);

/** 100 inside ±10 %, falling linearly to 0 at 40 % / 160 % of plan. */
function volumeScore(ratio: number): number {
  if (ratio >= 0.9 && ratio <= 1.1) return 100;
  if (ratio < 0.9) return Math.max(0, Math.round(((ratio - 0.4) / 0.5) * 100));
  return Math.max(0, Math.round(((1.6 - ratio) / 0.5) * 100));
}

export function computeCompliance(planned: PlannedLite, a: ActivityForCompliance): Compliance {
  const notes: string[] = [];

  let volume = 100;
  if (planned.plannedDurationSec) {
    const ratio = a.durationSec / planned.plannedDurationSec;
    volume = volumeScore(ratio);
    if (ratio < 0.9) notes.push(`Duration ${Math.round(ratio * 100)}% of plan`);
    if (ratio > 1.1) notes.push(`Duration ${Math.round(ratio * 100)}% of plan`);
  } else if (planned.plannedDistanceM && a.distanceM) {
    const ratio = a.distanceM / planned.plannedDistanceM;
    volume = volumeScore(ratio);
    if (ratio < 0.9 || ratio > 1.1) notes.push(`Distance ${Math.round(ratio * 100)}% of plan`);
  }

  let intensity: number | null = null;
  if (EASY_TYPES.has(planned.type) && a.hrZoneSeconds?.some((s) => s > 0)) {
    const total = a.hrZoneSeconds.reduce((s, x) => s + x, 0);
    const low = (a.hrZoneSeconds[0] + a.hrZoneSeconds[1]) / total;
    intensity = Math.max(0, Math.min(100, Math.round(((low - 0.4) / 0.4) * 100)));
    if (low < 0.8) notes.push(`Only ${Math.round(low * 100)}% of time in Z1–Z2 on an easy session`);
  } else if (QUALITY_TYPES.has(planned.type) && a.laps.length > 0) {
    intensity = workTargetScore(planned, a.laps, notes);
  }

  const score = intensity === null ? volume : Math.round(volume * 0.4 + intensity * 0.6);
  return { score, volume, intensity, notes };
}

/** Share of the planned work time that laps actually spent inside the work target band. */
function workTargetScore(planned: PlannedLite, laps: Lap[], notes: string[]): number | null {
  const work = flattenSteps(planned.structure).filter((s) => s.kind === "work");
  const paceTargets = work.filter((s) => s.target.type === "pace" && s.target.low && s.target.high);
  const powerTargets = work.filter((s) => s.target.type === "power" && s.target.low && s.target.high);
  const plannedWorkSec = work.reduce((sum, s) => {
    if (s.duration.type === "time") return sum + (s.duration.value ?? 0);
    if (s.duration.type === "distance" && s.target.type === "pace" && s.target.low && s.target.high)
      return sum + ((s.duration.value ?? 0) / 1000) * ((s.target.low + s.target.high) / 2);
    return sum;
  }, 0);
  if (plannedWorkSec <= 0) return null;

  let inTarget = 0;
  if (paceTargets.length) {
    const lo = Math.min(...paceTargets.map((s) => s.target.low!)) - 5;
    const hi = Math.max(...paceTargets.map((s) => s.target.high!)) + 5;
    for (const lap of laps) {
      if (!lap.distanceM) continue;
      const pace = lap.durationSec / (lap.distanceM / 1000);
      if (pace >= lo && pace <= hi) inTarget += lap.durationSec;
    }
  } else if (powerTargets.length) {
    const lo = Math.min(...powerTargets.map((s) => s.target.low!)) * 0.97;
    const hi = Math.max(...powerTargets.map((s) => s.target.high!)) * 1.03;
    for (const lap of laps) if (lap.avgPower && lap.avgPower >= lo && lap.avgPower <= hi) inTarget += lap.durationSec;
  } else {
    return null;
  }

  const ratio = Math.min(1, inTarget / plannedWorkSec);
  if (ratio < 0.8) notes.push(`About ${Math.round(ratio * 100)}% of the planned work was on target`);
  return Math.round(ratio * 100);
}

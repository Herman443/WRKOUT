import { addDays, dateRange } from "../dates";
import type { Sport } from "./workout-structure";

// Training load in TSS-equivalent points (100 = one hour at threshold), plus the
// Banister fitness/fatigue model (CTL 42 d, ATL 7 d) and acute:chronic workload ratio.

export interface LoadInput {
  sport: Sport;
  durationSec: number;
  distanceM?: number | null;
  avgHr?: number | null;
  normalizedPower?: number | null;
  avgPower?: number | null;
  rpe?: number | null;
}

export interface LoadMarkers {
  ftp?: number | null;
  thresholdPaceSecPerKm?: number | null;
  lthr?: number | null;
  restingHr?: number | null;
  maxHr?: number | null;
}

export type LoadMethod = "power" | "pace" | "hr" | "rpe" | "duration";

const clampIf = (x: number) => Math.min(1.25, Math.max(0.3, x));

function trimp(minutes: number, hrr: number) {
  return minutes * hrr * 0.64 * Math.exp(1.92 * hrr);
}

export function activityLoad(a: LoadInput, m: LoadMarkers): { value: number; method: LoadMethod } {
  const hours = a.durationSec / 3600;
  if (hours <= 0) return { value: 0, method: "duration" };

  const power = a.normalizedPower ?? a.avgPower;
  if (a.sport === "bike" && power && m.ftp) {
    const intensity = clampIf(power / m.ftp);
    return { value: Math.round(hours * intensity ** 2 * 100), method: "power" };
  }

  if (a.sport === "run" && a.distanceM && m.thresholdPaceSecPerKm) {
    const pace = a.durationSec / (a.distanceM / 1000);
    const intensity = clampIf(m.thresholdPaceSecPerKm / pace);
    return { value: Math.round(hours * intensity ** 2 * 100), method: "pace" };
  }

  if (a.avgHr && (m.lthr || m.maxHr)) {
    const rest = m.restingHr ?? 60;
    const max = m.maxHr ?? Math.round((m.lthr as number) / 0.9);
    const lthr = m.lthr ?? Math.round(max * 0.9);
    const hrr = Math.min(1, Math.max(0, (a.avgHr - rest) / (max - rest)));
    const hrrLt = (lthr - rest) / (max - rest);
    return {
      value: Math.round((trimp(hours * 60, hrr) / trimp(60, hrrLt)) * 100),
      method: "hr",
    };
  }

  if (a.rpe) {
    // RPE 1-10 mapped onto an intensity factor of roughly 0.5-1.05
    const intensity = clampIf(0.45 + a.rpe * 0.06);
    return { value: Math.round(hours * intensity ** 2 * 100), method: "rpe" };
  }

  return { value: Math.round(hours * 0.65 ** 2 * 100), method: "duration" };
}

const ZONE_IF: [RegExp, number][] = [
  [/recover|z1/i, 0.6],
  [/easy|endurance|z2|long/i, 0.7],
  [/tempo|marathon|z3/i, 0.85],
  [/sweet/i, 0.9],
  [/threshold|z4|\bt\b/i, 0.97],
  [/interval|vo2|z5/i, 1.05],
  [/rep|anaerobic|sprint|z6/i, 1.1],
];

const TYPE_IF: Partial<Record<string, number>> = {
  recovery: 0.6,
  easy: 0.7,
  long: 0.72,
  endurance: 0.68,
  tempo: 0.86,
  threshold: 0.9,
  intervals: 0.9,
  vo2max: 0.92,
  sweet_spot: 0.85,
  race_pace: 0.85,
  race: 0.95,
  strength: 0.6,
};

/** Rough planned TSS for a structured workout, from step durations and target zones. */
export function estimateWorkoutLoad(
  steps: { kind: string; durationSec: number; zone: string | null }[],
  type: string,
  fallbackDurationSec: number | null,
): number {
  if (steps.length === 0) {
    const intensity = TYPE_IF[type] ?? 0.7;
    return Math.round(((fallbackDurationSec ?? 0) / 3600) * intensity ** 2 * 100);
  }
  let tss = 0;
  for (const s of steps) {
    let intensity = s.kind === "work" ? (TYPE_IF[type] ?? 0.75) : s.kind === "rest" ? 0.4 : 0.6;
    if (s.zone) intensity = ZONE_IF.find(([re]) => re.test(s.zone!))?.[1] ?? intensity;
    tss += (s.durationSec / 3600) * intensity ** 2 * 100;
  }
  return Math.round(tss);
}

export interface FitnessPoint {
  date: string;
  load: number;
  ctl: number;
  atl: number;
  /** Form going into this day: yesterday's CTL - ATL */
  tsb: number;
}

export function fitnessSeries(
  loads: { date: string; load: number }[],
  start: string,
  end: string,
  init: { ctl: number; atl: number } = { ctl: 0, atl: 0 },
): FitnessPoint[] {
  const byDate = new Map<string, number>();
  for (const l of loads) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.load);
  const kCtl = 1 - Math.exp(-1 / 42);
  const kAtl = 1 - Math.exp(-1 / 7);
  let { ctl, atl } = init;
  return dateRange(start, end).map((date) => {
    const tsb = ctl - atl;
    const load = byDate.get(date) ?? 0;
    ctl += (load - ctl) * kCtl;
    atl += (load - atl) * kAtl;
    return { date, load, ctl: round1(ctl), atl: round1(atl), tsb: round1(tsb) };
  });
}

/** Rolling-average acute (7 d) : chronic (28 d) workload ratio ending on `date`. */
export function acwr(loads: { date: string; load: number }[], date: string): number | null {
  const sumBetween = (from: string) =>
    loads.filter((l) => l.date >= from && l.date <= date).reduce((s, l) => s + l.load, 0);
  const chronic = sumBetween(addDays(date, -27)) / 28;
  if (chronic <= 0) return null;
  return round2(sumBetween(addDays(date, -6)) / 7 / chronic);
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

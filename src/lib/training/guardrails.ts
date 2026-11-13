import { diffDays, weekday } from "../dates";
import type { WeekOutline } from "./plan";
import type { PlannedWorkoutInput } from "./planned";
import { isHardSession, QUALITY_TYPES, type Sport } from "./workout-structure";

// Hard rules the AI's plans must satisfy. Errors are sent back to the model for a
// corrected attempt; warnings are shown but accepted.

export interface GuardrailResult {
  errors: string[];
  warnings: string[];
}

const MAX_RAMP = 1.12;
const RAMP_SLACK_HOURS = 0.3;

export interface RaceInfo {
  sport: Sport;
  distanceM: number | null;
}

/** Long events (marathon+, long rides) need a two-week taper. */
function needsLongTaper(race: RaceInfo) {
  if (!race.distanceM) return false;
  return race.sport === "run" ? race.distanceM >= 30000 : race.distanceM >= 150000;
}

export function checkOutline(weeks: WeekOutline[], race: RaceInfo): GuardrailResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (weeks.length === 0) return { errors: ["Plan has no weeks"], warnings };

  weeks.forEach((w, i) => {
    if (w.index !== i) errors.push(`Week indexes must be consecutive from 0 (found ${w.index} at position ${i})`);
    if (i > 0 && diffDays(weeks[i - 1].startDate, w.startDate) !== 7)
      errors.push(`Week ${i} must start 7 days after week ${i - 1}`);
    if (weekday(w.startDate) !== 0) errors.push(`Week ${i} must start on a Monday`);
  });

  // Ramp rate: compare to the previous week, or to the last normal week after a deload.
  let lastNormal: WeekOutline | null = null;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const ref = i > 0 && weeks[i - 1].isDeload ? lastNormal : weeks[i - 1];
    if (ref && w.phase !== "taper" && w.phase !== "race") {
      const limit = ref.targetHours * MAX_RAMP + RAMP_SLACK_HOURS;
      if (w.targetHours > limit)
        errors.push(
          `Week ${i} jumps to ${w.targetHours} h from ${ref.targetHours} h (max ~${limit.toFixed(1)} h, ≈10 % ramp)`,
        );
      if (w.targetRunKm && ref.targetRunKm && w.targetRunKm > ref.targetRunKm * MAX_RAMP + 3)
        errors.push(`Week ${i} run volume ${w.targetRunKm} km ramps too fast from ${ref.targetRunKm} km`);
    }
    if (!w.isDeload) lastNormal = w;
  }

  // Recovery: no more than four loading weeks in a row before the taper.
  let streak = 0;
  for (const w of weeks) {
    if (w.phase === "taper" || w.phase === "race") break;
    streak = w.isDeload ? 0 : streak + 1;
    if (streak > 4 && weeks.length > 6) {
      errors.push(`Week ${w.index} is the ${streak}th loading week in a row; insert a deload every 3–4 weeks`);
      streak = 0;
    }
  }
  weeks.forEach((w, i) => {
    if (!w.isDeload || i === 0) return;
    const ref = lastNormalBefore(weeks, i);
    if (ref && w.targetHours > ref.targetHours * 0.85)
      warnings.push(`Deload week ${i} is only ${pctDrop(ref.targetHours, w.targetHours)} % lighter`);
  });

  // Taper
  const peak = Math.max(...weeks.map((w) => w.targetHours));
  const last = weeks[weeks.length - 1];
  if (weeks.length >= 4) {
    if (last.targetHours > peak * 0.7) errors.push(`Race week (${last.targetHours} h) must be ≤ 70 % of peak (${peak} h)`);
    if (needsLongTaper(race) && weeks.length >= 8) {
      const prev = weeks[weeks.length - 2];
      if (prev.targetHours > peak * 0.85)
        errors.push(`Week before the race (${prev.targetHours} h) must be ≤ 85 % of peak for a long event`);
    }
  }
  if (last.phase !== "race" && last.phase !== "taper") warnings.push("Final week should be the race/taper week");

  return { errors, warnings };
}

function lastNormalBefore(weeks: WeekOutline[], i: number) {
  for (let j = i - 1; j >= 0; j--) if (!weeks[j].isDeload) return weeks[j];
  return null;
}

const pctDrop = (from: number, to: number) => Math.round((1 - to / from) * 100);

export interface WeekContext {
  /** Allowed weekdays, 0 = Monday … 6 = Sunday */
  availableDays: number[];
  targetHours: number | null;
  /** Weeks under ~4 h get at most two quality sessions */
  maxQuality?: number;
}

export function checkWeek(workouts: PlannedWorkoutInput[], ctx: WeekContext): GuardrailResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sessions = workouts.filter((w) => w.sport !== "strength" && w.type !== "strength");

  for (const w of workouts) {
    if (!ctx.availableDays.includes(weekday(w.date)))
      errors.push(`"${w.title}" on ${w.date} falls on an unavailable day`);
  }

  const perDay = new Map<string, PlannedWorkoutInput[]>();
  for (const w of sessions) perDay.set(w.date, [...(perDay.get(w.date) ?? []), w]);
  for (const [date, list] of perDay) if (list.length > 2) errors.push(`${date} has ${list.length} sessions (max 2)`);

  const totalHours = sessions.reduce((s, w) => s + (w.plannedDurationSec ?? 0), 0) / 3600;
  const maxQuality = ctx.maxQuality ?? (totalHours < 4 ? 2 : 3);
  const quality = sessions.filter((w) => QUALITY_TYPES.has(w.type));
  if (quality.length > maxQuality)
    errors.push(`${quality.length} quality sessions this week (max ${maxQuality}); keep ~80 % of time easy`);

  const hardDates = [...new Set(sessions.filter((w) => isHardSession(w.type)).map((w) => w.date))].sort();
  for (let i = 1; i < hardDates.length; i++) {
    if (diffDays(hardDates[i - 1], hardDates[i]) === 1)
      errors.push(`Hard sessions on consecutive days (${hardDates[i - 1]} and ${hardDates[i]})`);
  }

  const runs = sessions.filter((w) => w.sport === "run");
  const runTime = runs.reduce((s, w) => s + (w.plannedDurationSec ?? 0), 0);
  const longest = Math.max(0, ...runs.map((w) => w.plannedDurationSec ?? 0));
  if (runs.length >= 3 && runTime > 0) {
    const share = longest / runTime;
    if (share > 0.45) errors.push(`Long run is ${Math.round(share * 100)} % of weekly run time (max ~40 %)`);
    else if (share > 0.38) warnings.push(`Long run is ${Math.round(share * 100)} % of weekly run time`);
  }

  if (ctx.targetHours && totalHours > 0) {
    const ratio = totalHours / ctx.targetHours;
    if (ratio > 1.15 || ratio < 0.8)
      warnings.push(`Week totals ${totalHours.toFixed(1)} h vs target ${ctx.targetHours} h`);
  }

  for (const w of workouts) {
    if (w.structure.length === 0 && w.sport !== "strength")
      errors.push(`"${w.title}" on ${w.date} has no structured steps`);
  }

  return { errors, warnings };
}

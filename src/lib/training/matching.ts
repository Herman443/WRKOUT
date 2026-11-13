import { diffDays } from "../dates";
import type { PlannedLite } from "./planned";
import type { Sport } from "./workout-structure";

export interface ActivityLite {
  sport: Sport;
  /** Local calendar date of the start */
  date: string;
  durationSec: number;
}

/**
 * Pick the planned workout an activity most likely fulfils: same sport, same day
 * (or one day off), closest planned duration. Returns null when nothing fits.
 */
export function matchActivity(activity: ActivityLite, candidates: PlannedLite[]): PlannedLite | null {
  let best: { w: PlannedLite; score: number } | null = null;
  for (const w of candidates) {
    if (w.sport !== activity.sport) continue;
    if (w.status !== "planned" && w.status !== "missed") continue;
    const dayOff = Math.abs(diffDays(w.date, activity.date));
    if (dayOff > 1) continue;
    let score = dayOff;
    if (w.plannedDurationSec && activity.durationSec > 0) {
      const ratio = activity.durationSec / w.plannedDurationSec;
      if (ratio < 0.3 || ratio > 3) continue;
      score += Math.abs(Math.log(ratio));
    }
    if (!best || score < best.score) best = { w, score };
  }
  return best?.w ?? null;
}

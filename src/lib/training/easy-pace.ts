import type { Lap } from "./compliance";
import type { Zone } from "./zones";

// Learns the athlete's easy pace from what they actually ran: the pace of recent easy runs
// while heart rate sat in Z2. It anchors the fast end of the easy band, so the band follows
// the athlete's aerobic fitness in both directions instead of a race-based model.

export interface EasyPaceRun {
  /** Laps with trusted distance (outdoor, or a corrected treadmill run) */
  laps: Lap[];
  /** Whole-run fallback when there are no laps */
  activeSec: number;
  distanceM: number | null;
  avgHr: number | null;
}

export interface LearnedEasyPace {
  /** sec/km, flat-equivalent */
  paceSecPerKm: number;
  /** Runs that contributed */
  runs: number;
  /** Seconds of Z2 running the estimate rests on */
  sampleSec: number;
}

/** Recent window and how much Z2 running is needed before the estimate is trusted. */
export const EASY_PACE_WINDOW_DAYS = 42;
export const MIN_RUNS = 3;
export const MIN_SAMPLE_SEC = 60 * 60;
/** Laps shorter than this (strides, lap-button blips) are ignored. */
const MIN_LAP_SEC = 120;
/** A run counts as easy when at least this share of its time is at or under the Z2 ceiling. */
const EASY_SHARE = 0.8;
/** Anything outside this is a recording glitch or walking, not running pace. */
const PLAUSIBLE: [number, number] = [150, 720];

const lapPace = (l: Lap) => {
  const grade = (l.inclinePct ?? 0) / 100;
  // Same flat-equivalent as the treadmill code (ACSM: flat speed = v · (1 + 4.5 · grade)).
  return l.durationSec / ((l.distanceM * (1 + 4.5 * grade)) / 1000);
};

/** Time-weighted median pace of Z2 running in recent easy runs, or null with too little data. */
export function learnEasyPace(runs: EasyPaceRun[], z2: Pick<Zone, "low" | "high">): LearnedEasyPace | null {
  const samples: { pace: number; sec: number }[] = [];
  let used = 0;
  for (const r of runs) {
    const laps: Lap[] = r.laps.length
      ? r.laps
      : r.distanceM && r.avgHr
        ? [{ durationSec: r.activeSec, distanceM: r.distanceM, avgHr: r.avgHr }]
        : [];
    const withHr = laps.filter((l) => l.avgHr && l.durationSec > 0 && l.distanceM > 0);
    const total = withHr.reduce((s, l) => s + l.durationSec, 0);
    if (!total) continue;
    // Skip hard sessions: recovery jogs after reps sit in Z2 by heart rate but are not easy running.
    const easySec = withHr.filter((l) => l.avgHr! <= z2.high).reduce((s, l) => s + l.durationSec, 0);
    if (easySec / total < EASY_SHARE) continue;

    let any = false;
    for (const l of withHr) {
      if (l.durationSec < MIN_LAP_SEC || l.avgHr! < z2.low || l.avgHr! > z2.high) continue;
      const pace = lapPace(l);
      if (pace < PLAUSIBLE[0] || pace > PLAUSIBLE[1]) continue;
      samples.push({ pace, sec: l.durationSec });
      any = true;
    }
    if (any) used++;
  }

  const sampleSec = samples.reduce((s, x) => s + x.sec, 0);
  if (used < MIN_RUNS || sampleSec < MIN_SAMPLE_SEC) return null;

  samples.sort((a, b) => a.pace - b.pace);
  let acc = 0;
  const median = samples.find((s) => (acc += s.sec) >= sampleSec / 2)!.pace;
  return { paceSecPerKm: Math.round(median), runs: used, sampleSec: Math.round(sampleSec) };
}

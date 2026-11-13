import type { Lap } from "./compliance";

// Treadmill runs. A watch guesses treadmill distance from arm swing, which is often 5–10 %
// off, so treadmill distance and pace are only trusted once the athlete has entered what the
// belt said. Incline is turned into an equivalent flat effort with the ACSM running equation
// (VO2 = 0.2·v + 0.9·v·grade + 3.5), i.e. flat speed = v · (1 + 4.5 · grade).

/** Where the athlete usually runs; "treadmill" shows pace targets as belt speed. Stored in kv `run_surface`. */
export type RunSurface = "outdoor" | "treadmill";

/** Garmin activity type keys recorded indoors on a belt. */
export const isTreadmill = (subSport: string | null | undefined) => /treadmill|indoor_run/i.test(subSport ?? "");

/** Stored in `activities.extra.treadmill` once the athlete has corrected a treadmill run. */
export interface TreadmillCorrection {
  /** Total typed in, speed per lap typed in, or a live session in the app */
  method: "distance" | "laps" | "session";
  originalDistanceM: number | null;
  originalElevationGainM: number | null;
  originalLaps: Lap[];
  correctedAt: string;
}

export function treadmillCorrection(extra: Record<string, unknown> | null | undefined): TreadmillCorrection | null {
  const t = extra?.treadmill;
  return t && typeof t === "object" ? (t as TreadmillCorrection) : null;
}

/** Whether distance and pace can be believed: anything off a treadmill, or a corrected treadmill run. */
export const paceTrusted = (a: { subSport: string | null; extra: Record<string, unknown> | null }) =>
  !isTreadmill(a.subSport) || treadmillCorrection(a.extra) !== null;

export const kmhFromPace = (secPerKm: number) => 3600 / secPerKm;

/** Treadmills step in 0.1 km/h. */
export const formatKmh = (kmh: number) => (Math.round(kmh * 10) / 10).toFixed(1);

/** Lap distances scaled to the total the treadmill showed, all at one incline. */
export function scaleLaps(laps: Lap[], totalM: number, inclinePct: number | null): Lap[] {
  const current = laps.reduce((s, l) => s + l.distanceM, 0);
  const totalSec = laps.reduce((s, l) => s + l.durationSec, 0);
  return laps.map((l) => ({
    ...l,
    // Laps without a distance (e.g. a paused lap) get their share by time.
    distanceM: Math.round(current > 0 ? (l.distanceM / current) * totalM : totalSec > 0 ? (l.durationSec / totalSec) * totalM : 0),
    inclinePct,
  }));
}

/** Laps rebuilt from the belt speed (km/h) and incline (%) of each one; blanks keep the lap as it was. */
export function lapsFromBelt(laps: Lap[], belt: { kmh: number | null; inclinePct: number | null }[]): Lap[] {
  return laps.map((l, i) => {
    const b = belt[i];
    if (!b) return l;
    return {
      ...l,
      distanceM: b.kmh != null ? Math.round((b.kmh / 3.6) * l.durationSec) : l.distanceM,
      inclinePct: b.inclinePct ?? l.inclinePct ?? null,
    };
  });
}

const grade = (l: Lap) => Math.min(0.25, Math.max(0, (l.inclinePct ?? 0) / 100));

/** Flat-ground distance with the same metabolic cost, for pace-based load. */
export const equivalentFlatDistance = (laps: Lap[]) => laps.reduce((s, l) => s + l.distanceM * (1 + 4.5 * grade(l)), 0);

export const climbM = (laps: Lap[]) => laps.reduce((s, l) => s + l.distanceM * grade(l), 0);

/** Time-weighted average incline, or null when no lap has one. */
export function averageIncline(laps: Lap[]): number | null {
  const withIncline = laps.filter((l) => l.inclinePct != null);
  const sec = withIncline.reduce((s, l) => s + l.durationSec, 0);
  if (!withIncline.length || sec <= 0) return null;
  return Math.round((withIncline.reduce((s, l) => s + l.inclinePct! * l.durationSec, 0) / sec) * 10) / 10;
}

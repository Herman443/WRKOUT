import type { Lap } from "./compliance";

/**
 * Seconds the activity was actually running: the sum of the laps' timer time when there are
 * laps, else the watch's moving time, else elapsed time.
 *
 * Laps come first because they are what distance and lap paces are measured against. That
 * keeps the headline pace equal to the laps' average, matches the "avg pace" a Garmin watch
 * shows (timer time, not moving time), and stays right after a treadmill correction or a
 * live belt session replaces the laps. The watch's moving time on a treadmill is judged
 * from its own wrist-guessed speed, so it can undercount the run by minutes.
 */
export function activeSec(a: { durationSec: number; movingSec: number | null; laps: Lap[] | null | undefined }): number {
  const lapSec = (a.laps ?? []).reduce((sum, l) => sum + (l.durationSec || 0), 0);
  if (lapSec > 0) return lapSec;
  return a.movingSec ?? a.durationSec;
}

/** Average pace in seconds per km, or null without distance. */
export function avgPaceSecPerKm(a: Parameters<typeof activeSec>[0] & { distanceM: number | null }): number | null {
  return a.distanceM ? activeSec(a) / (a.distanceM / 1000) : null;
}

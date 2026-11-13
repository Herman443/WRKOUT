import type { Lap } from "./compliance";
import { kmhFromPace } from "./treadmill";
import type { SimpleStep } from "./workout-structure";

// A treadmill session run live in the app. The phone records belt speed and incline as
// segments with wall-clock times (a pause is a gap between segments). Laps are the plan's
// steps, or the athlete's own lap presses on an unplanned run. Pure, so the live screen and
// the server share it.

export interface Segment {
  startMs: number;
  endMs: number;
  kmh: number;
  inclinePct: number;
  lap: number;
}

/** One step of a planned workout, as the live screen needs it. */
export interface LiveStep {
  kind: SimpleStep["kind"];
  /** e.g. "Work threshold" */
  label: string;
  duration: { type: "time" | "distance" | "open"; value: number | null };
  /** Belt speed for a pace target, [slow, fast] km/h */
  kmh: [number, number] | null;
  /** The target as shown in the plan, e.g. "12.9–13.3 km/h" or "≤150 bpm" */
  target: string | null;
  note: string | null;
  /** Intensity level 1–5, for the step's colour */
  level?: number;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export function stepKmh(step: SimpleStep): [number, number] | null {
  const t = step.target;
  if (t.type !== "pace" || !(t.low || t.high)) return null;
  return [round1(kmhFromPace((t.high ?? t.low)!)), round1(kmhFromPace((t.low ?? t.high)!))];
}

/** The speed to put the belt on for a step: the middle of its target, or null when it has none. */
export const plannedKmh = (step: LiveStep | undefined) => (step?.kmh ? round1((step.kmh[0] + step.kmh[1]) / 2) : null);

export const segmentSec = (s: Pick<Segment, "startMs" | "endMs">) => Math.max(0, (s.endMs - s.startMs) / 1000);
export const segmentM = (s: Segment) => (s.kmh / 3.6) * segmentSec(s);

/** Time (sec) and distance (m) of some segments, optionally only one lap's. */
export function totals(segments: Segment[], lap?: number) {
  const segs = lap === undefined ? segments : segments.filter((s) => s.lap === lap);
  return { sec: segs.reduce((sum, s) => sum + segmentSec(s), 0), m: segs.reduce((sum, s) => sum + segmentM(s), 0) };
}

/** What is left of a step: seconds for a time step, metres for a distance step, null when open. */
export function stepRemaining(step: LiveStep | undefined, lapSec: number, lapM: number): { unit: "sec" | "m"; value: number } | null {
  if (!step?.duration.value) return null;
  if (step.duration.type === "time") return { unit: "sec", value: step.duration.value - lapSec };
  if (step.duration.type === "distance") return { unit: "m", value: step.duration.value - lapM };
  return null;
}

export interface SessionLap extends Lap {
  startMs: number;
  endMs: number;
}

/** Laps (one per lap index) with time, belt distance and time-weighted incline. */
export function lapsFromSegments(segments: Segment[]): SessionLap[] {
  const byLap = new Map<number, Segment[]>();
  for (const s of [...segments].sort((a, b) => a.startMs - b.startMs)) {
    if (segmentSec(s) <= 0) continue;
    byLap.set(s.lap, [...(byLap.get(s.lap) ?? []), s]);
  }
  return [...byLap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, segs]) => {
      const sec = segs.reduce((sum, s) => sum + segmentSec(s), 0);
      return {
        startMs: segs[0].startMs,
        endMs: segs.at(-1)!.endMs,
        durationSec: Math.round(sec),
        distanceM: Math.round(segs.reduce((sum, s) => sum + segmentM(s), 0)),
        inclinePct: round1(segs.reduce((sum, s) => sum + s.inclinePct * segmentSec(s), 0) / sec),
      };
    })
    .filter((l) => l.durationSec >= 1);
}

/** Average heart rate per lap from the watch's samples ([epoch ms, bpm]). */
export function withHeartRate(laps: SessionLap[], samples: [number, number][]): Lap[] {
  return laps.map(({ startMs, endMs, ...lap }) => {
    const inLap = samples.filter(([t]) => t >= startMs && t <= endMs);
    return { ...lap, avgHr: inLap.length ? Math.round(inLap.reduce((s, [, hr]) => s + hr, 0) / inLap.length) : null };
  });
}

/** How much of the shorter of two time spans the other one covers, 0–1. */
export function overlapShare(a: [number, number], b: [number, number]): number {
  const overlap = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  const shorter = Math.min(a[1] - a[0], b[1] - b[0]);
  return shorter > 0 ? Math.max(0, overlap) / shorter : 0;
}

// ---------- the live session's state, kept on the phone until it is saved ----------

export const LIVE_STORAGE_KEY = "wrkout:treadmill";

export interface LiveState {
  v: 1;
  /** Made on the phone, so saving twice (e.g. after a dropped connection) stores one session */
  id: string;
  workoutId: string | null;
  title: string;
  /** Finished segments */
  segments: Segment[];
  /** The segment running now; null while paused or not started */
  open: Omit<Segment, "endMs"> | null;
  kmh: number;
  inclinePct: number;
  lap: number;
}

export const newLive = (workoutId: string | null, title: string, kmh: number): LiveState => ({
  v: 1,
  id: crypto.randomUUID(),
  workoutId,
  title,
  segments: [],
  open: null,
  kmh,
  inclinePct: 1,
  lap: 0,
});

export const hasStarted = (s: LiveState) => s.segments.length > 0 || s.open !== null;

/** Every segment so far, the running one cut off at `now`. */
export const segmentsAt = (s: LiveState, now: number): Segment[] =>
  s.open ? [...s.segments, { ...s.open, endMs: Math.max(now, s.open.startMs) }] : s.segments;

const close = (s: LiveState, now: number): LiveState => ({ ...s, segments: segmentsAt(s, now).filter((x) => x.endMs > x.startMs), open: null });
const reopen = (s: LiveState, now: number): LiveState => ({ ...s, open: { startMs: now, kmh: s.kmh, inclinePct: s.inclinePct, lap: s.lap } });

export const start = (s: LiveState, now: number) => (s.open ? s : reopen(s, now));
export const pause = (s: LiveState, now: number) => (s.open ? close(s, now) : s);

/** New belt settings. Taps within a couple of seconds adjust the same segment instead of making tiny ones. */
export function setBelt(s: LiveState, now: number, belt: { kmh?: number; inclinePct?: number }): LiveState {
  const next = {
    ...s,
    kmh: round1(Math.min(25, Math.max(0, belt.kmh ?? s.kmh))),
    inclinePct: round1(Math.min(30, Math.max(-3, belt.inclinePct ?? s.inclinePct))),
  };
  if (!s.open) return next;
  if (now - s.open.startMs < 2000) return { ...next, open: { ...s.open, kmh: next.kmh, inclinePct: next.inclinePct } };
  return reopen(close(next, now), now);
}

/** Starts the next step (or lap), with the belt on that step's planned speed when it has one. */
export function nextLap(s: LiveState, now: number, steps: LiveStep[]): LiveState {
  const running = s.open !== null;
  const closed = close(s, now);
  const lap = s.lap + 1;
  const moved = { ...closed, lap, kmh: plannedKmh(steps[lap]) ?? s.kmh };
  return running ? reopen(moved, now) : moved;
}

/**
 * Moves on when the current planned step is done, cutting it at the moment it ended rather
 * than at the (later) tick, and catching up over several steps after the screen was locked.
 */
export function advanceIfDue(s: LiveState, now: number, steps: LiveStep[]): LiveState {
  for (let i = 0; i < steps.length && s.open; i++) {
    const lap = totals(segmentsAt(s, now), s.lap);
    const left = stepRemaining(steps[s.lap], lap.sec, lap.m);
    if (!left || left.value > 0) break;
    const overSec = left.unit === "sec" ? -left.value : s.open.kmh > 0 ? -left.value / (s.open.kmh / 3.6) : 0;
    s = nextLap(s, Math.max(s.open.startMs, now - overSec * 1000), steps);
  }
  return s;
}

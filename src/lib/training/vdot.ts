// Jack Daniels' VDOT model (Daniels & Gilbert oxygen-cost and time-to-exhaustion curves).
// Distances in metres, times in seconds, paces in seconds per km.

const vo2AtVelocity = (metresPerMin: number) =>
  -4.6 + 0.182258 * metresPerMin + 0.000104 * metresPerMin ** 2;

const fractionSustainable = (minutes: number) =>
  0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);

const velocityAtVo2 = (vo2: number) =>
  (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (4.6 + vo2))) / (2 * 0.000104);

export function vdotFromRace(distanceM: number, timeSec: number): number {
  const minutes = timeSec / 60;
  return vo2AtVelocity(distanceM / minutes) / fractionSustainable(minutes);
}

/** Predicted race time (sec) for a distance at a given VDOT, by bisection. */
export function predictRaceTime(vdot: number, distanceM: number): number {
  let lo = 60;
  let hi = 60 * 60 * 12;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    // Higher time -> lower VDOT
    if (vdotFromRace(distanceM, mid) > vdot) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const paceAtFraction = (vdot: number, fraction: number) => 60000 / velocityAtVo2(vdot * fraction);

export interface RunPaces {
  vdot: number;
  /** [fast, slow] sec/km */
  easy: [number, number];
  marathon: number;
  threshold: number;
  interval: number;
  repetition: number;
}

export function trainingPaces(vdot: number): RunPaces {
  return {
    vdot,
    easy: [paceAtFraction(vdot, 0.68), paceAtFraction(vdot, 0.6)],
    marathon: predictRaceTime(vdot, 42195) / 42.195,
    threshold: paceAtFraction(vdot, 0.88),
    interval: paceAtFraction(vdot, 0.975),
    repetition: paceAtFraction(vdot, 1.055),
  };
}

/** Rough VDOT estimate from a comfortable zone 2 pace (sec/km), assuming ~64% of VO2max. */
export function vdotFromEasyPace(paceSecPerKm: number): number {
  return vo2AtVelocity(60000 / paceSecPerKm) / 0.64;
}

export interface RaceResult {
  distanceM: number;
  timeSec: number;
  date?: string | null;
}

/** Best current VDOT from recent results; older results (>18 months) are discounted. */
export function bestVdot(results: RaceResult[], today = new Date()): number | null {
  let best: number | null = null;
  for (const r of results) {
    if (!r.distanceM || !r.timeSec) continue;
    let v = vdotFromRace(r.distanceM, r.timeSec);
    if (r.date) {
      const months = (today.getTime() - new Date(r.date).getTime()) / (30.44 * 86400000);
      if (months > 18) v *= Math.max(0.9, 1 - (months - 18) * 0.003);
    }
    if (best === null || v > best) best = v;
  }
  return best;
}

export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatDuration(sec: number): string {
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** "45m", "1h05" */
export function compactDuration(sec: number): string {
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

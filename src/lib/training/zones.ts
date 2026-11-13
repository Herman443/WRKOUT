import { trainingPaces, type RunPaces } from "./vdot";

export interface Zone {
  name: string;
  low: number;
  high: number;
}

/** Five heart-rate zones from lactate threshold HR (Friel). Bike thresholds sit slightly lower. */
export function hrZonesFromLthr(lthr: number, sport: "run" | "bike" = "run"): Zone[] {
  const cuts = sport === "run" ? [0.85, 0.9, 0.95, 1.0, 1.06] : [0.81, 0.9, 0.94, 1.0, 1.06];
  return [
    { name: "Z1", low: 0, high: Math.round(lthr * cuts[0]) - 1 },
    { name: "Z2", low: Math.round(lthr * cuts[0]), high: Math.round(lthr * cuts[1]) - 1 },
    { name: "Z3", low: Math.round(lthr * cuts[1]), high: Math.round(lthr * cuts[2]) - 1 },
    { name: "Z4", low: Math.round(lthr * cuts[2]), high: Math.round(lthr * cuts[3]) - 1 },
    { name: "Z5", low: Math.round(lthr * cuts[3]), high: Math.round(lthr * cuts[4]) + 10 },
  ];
}

/** Five heart-rate zones from max HR, using heart-rate reserve when resting HR is known. */
export function hrZonesFromMax(maxHr: number, restingHr?: number | null): Zone[] {
  const at = (pct: number) =>
    Math.round(restingHr ? restingHr + (maxHr - restingHr) * pct : maxHr * pct);
  const cuts = restingHr ? [0.5, 0.6, 0.7, 0.8, 0.9] : [0.6, 0.7, 0.8, 0.87, 0.93];
  return [
    { name: "Z1", low: at(cuts[0]), high: at(cuts[1]) - 1 },
    { name: "Z2", low: at(cuts[1]), high: at(cuts[2]) - 1 },
    { name: "Z3", low: at(cuts[2]), high: at(cuts[3]) - 1 },
    { name: "Z4", low: at(cuts[3]), high: at(cuts[4]) - 1 },
    { name: "Z5", low: at(cuts[4]), high: maxHr },
  ];
}

/** Coggan power zones from FTP. */
export function powerZones(ftp: number): Zone[] {
  const at = (pct: number) => Math.round(ftp * pct);
  return [
    { name: "Z1 Recovery", low: 0, high: at(0.55) },
    { name: "Z2 Endurance", low: at(0.56), high: at(0.75) },
    { name: "Z3 Tempo", low: at(0.76), high: at(0.87) },
    { name: "Sweet spot", low: at(0.88), high: at(0.94) },
    { name: "Z4 Threshold", low: at(0.95), high: at(1.05) },
    { name: "Z5 VO2max", low: at(1.06), high: at(1.2) },
    { name: "Z6 Anaerobic", low: at(1.21), high: at(1.5) },
  ];
}

/** Run pace zones (sec/km, low = faster bound) derived from VDOT paces. */
export function paceZones(p: RunPaces): Zone[] {
  return [
    { name: "Easy", low: p.easy[0], high: p.easy[1] },
    { name: "Marathon", low: p.marathon - 5, high: p.marathon + 5 },
    { name: "Threshold", low: p.threshold - 4, high: p.threshold + 4 },
    { name: "Interval", low: p.interval - 4, high: p.interval + 4 },
    { name: "Repetition", low: p.repetition - 4, high: p.repetition + 4 },
  ];
}

export interface AthleteMarkers {
  vdot?: number | null;
  maxHr?: number | null;
  restingHr?: number | null;
  lthrRun?: number | null;
  lthrBike?: number | null;
  ftp?: number | null;
}

export interface AthleteZones {
  runPaces: RunPaces | null;
  runPaceZones: Zone[] | null;
  runHr: Zone[] | null;
  bikeHr: Zone[] | null;
  bikePower: Zone[] | null;
}

export function computeZones(m: AthleteMarkers): AthleteZones {
  const runPaces = m.vdot ? trainingPaces(m.vdot) : null;
  const runHr = m.lthrRun
    ? hrZonesFromLthr(m.lthrRun, "run")
    : m.maxHr
      ? hrZonesFromMax(m.maxHr, m.restingHr)
      : null;
  const bikeHr = m.lthrBike
    ? hrZonesFromLthr(m.lthrBike, "bike")
    : m.lthrRun
      ? hrZonesFromLthr(Math.round(m.lthrRun * 0.95), "bike")
      : m.maxHr
        ? hrZonesFromMax(m.maxHr, m.restingHr)
        : null;
  return {
    runPaces,
    runPaceZones: runPaces ? paceZones(runPaces) : null,
    runHr,
    bikeHr,
    bikePower: m.ftp ? powerZones(m.ftp) : null,
  };
}

/** Collapse a 5-zone HR time distribution into the 3-zone (low / threshold / high) model. */
export function threeZoneSplit(secondsPerZone: number[]): { low: number; moderate: number; high: number } {
  const [z1 = 0, z2 = 0, z3 = 0, z4 = 0, z5 = 0] = secondsPerZone;
  const total = z1 + z2 + z3 + z4 + z5 || 1;
  return { low: (z1 + z2) / total, moderate: z3 / total, high: (z4 + z5) / total };
}

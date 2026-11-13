import { flattenSteps, type SimpleStep, type Step, type WorkoutType } from "./workout-structure";

// Maps workout steps onto a 1-5 intensity scale (the zone colours in the UI).

const ZONE_LEVEL: [RegExp, number][] = [
  [/recover|z1|rest/i, 1],
  [/easy|endurance|aerobic|z2|long/i, 2],
  [/tempo|marathon|steady|z3/i, 3],
  [/sweet|threshold|\bt\b|z4|cruise/i, 4],
  [/interval|vo2|rep|sprint|anaerobic|z5|z6|race/i, 5],
];

const TYPE_LEVEL: Partial<Record<WorkoutType, number>> = {
  recovery: 1,
  easy: 2,
  long: 2,
  endurance: 2,
  strides: 2,
  strength: 2,
  cross: 2,
  progression: 3,
  fartlek: 4,
  tempo: 3,
  race_pace: 3,
  threshold: 4,
  sweet_spot: 4,
  hills: 5,
  intervals: 5,
  vo2max: 5,
  race: 5,
  brick: 3,
};

export function stepLevel(step: SimpleStep, type: WorkoutType): number {
  if (step.kind === "rest") return 1;
  if (step.target.zone) {
    const hit = ZONE_LEVEL.find(([re]) => re.test(step.target.zone!));
    if (hit) return hit[1];
  }
  if (step.target.type === "rpe" && step.target.high) return Math.min(5, Math.max(1, Math.round(step.target.high / 2)));
  if (step.kind === "warmup" || step.kind === "cooldown" || step.kind === "recovery") return 1;
  return TYPE_LEVEL[type] ?? 2;
}

export interface SilhouetteBar {
  level: number;
  seconds: number;
}

/** Bars for the intensity silhouette: one per step, sized by estimated duration. */
export function silhouetteBars(
  steps: Step[],
  type: WorkoutType,
  plannedDurationSec: number | null,
  fallbackPace = 330,
): SilhouetteBar[] {
  const flat = flattenSteps(steps);
  if (flat.length === 0) return [{ level: TYPE_LEVEL[type] ?? 2, seconds: plannedDurationSec ?? 1800 }];
  return flat.map((s) => {
    const t = s.target;
    const pace = t.type === "pace" && t.low && t.high ? (t.low + t.high) / 2 : fallbackPace;
    const seconds =
      s.duration.type === "time"
        ? (s.duration.value ?? 60)
        : s.duration.type === "distance"
          ? ((s.duration.value ?? 1000) / 1000) * pace
          : 300;
    return { level: stepLevel(s, type), seconds };
  });
}

export const LEVEL_COLOR = ["", "bg-z1", "bg-z2", "bg-z3", "bg-z4", "bg-z5"] as const;

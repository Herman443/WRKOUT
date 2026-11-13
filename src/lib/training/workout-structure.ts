import { z } from "zod";

// Structured workouts. The shape mirrors Garmin's workout model (steps with a duration
// condition and a target, plus one level of repeat blocks) so plans can later be exported
// to a watch. All fields are required-but-nullable so the schema works with strict
// structured outputs.

export const sportSchema = z.enum(["run", "bike", "swim", "strength", "other"]);
export type Sport = z.infer<typeof sportSchema>;

export const workoutTypeSchema = z.enum([
  "easy",
  "recovery",
  "long",
  "endurance",
  "strides",
  "progression",
  "fartlek",
  "tempo",
  "threshold",
  "intervals",
  "vo2max",
  "hills",
  "sweet_spot",
  "race_pace",
  "race",
  "brick",
  "strength",
  "cross",
]);
export type WorkoutType = z.infer<typeof workoutTypeSchema>;

/** Sessions that count toward the weekly quality-session cap. */
export const QUALITY_TYPES: ReadonlySet<WorkoutType> = new Set([
  "fartlek",
  "tempo",
  "threshold",
  "intervals",
  "vo2max",
  "hills",
  "sweet_spot",
  "race_pace",
  "race",
]);

/** Sessions that should not be scheduled on consecutive days. */
export const isHardSession = (type: WorkoutType) => QUALITY_TYPES.has(type) || type === "long";

export const targetSchema = z.object({
  type: z.enum(["pace", "hr", "power", "rpe", "none"]),
  zone: z.string().nullable().describe("Named zone, e.g. 'Easy', 'Threshold', 'Z2', 'Sweet spot'"),
  low: z
    .number()
    .nullable()
    .describe("pace: faster bound in sec/km; hr: bpm; power: watts; rpe: 1-10"),
  high: z.number().nullable().describe("pace: slower bound in sec/km; hr: bpm; power: watts; rpe: 1-10"),
});
export type Target = z.infer<typeof targetSchema>;

export const durationSchema = z.object({
  type: z.enum(["time", "distance", "open"]),
  value: z.number().nullable().describe("seconds for time, metres for distance, null for open"),
});

export const simpleStepSchema = z.object({
  kind: z.enum(["warmup", "work", "recovery", "rest", "cooldown"]),
  duration: durationSchema,
  target: targetSchema,
  note: z.string().nullable(),
});
export type SimpleStep = z.infer<typeof simpleStepSchema>;

export const repeatStepSchema = z.object({
  kind: z.literal("repeat"),
  times: z.number().int(),
  steps: z.array(simpleStepSchema),
});
export type RepeatStep = z.infer<typeof repeatStepSchema>;

export const stepSchema = z.union([simpleStepSchema, repeatStepSchema]);
export type Step = z.infer<typeof stepSchema>;

export function flattenSteps(steps: Step[]): SimpleStep[] {
  return steps.flatMap((s) =>
    s.kind === "repeat" ? Array.from({ length: Math.max(0, s.times) }, () => s.steps).flat() : [s],
  );
}

function stepPace(step: SimpleStep, fallbackPace: number): number {
  const t = step.target;
  if (t.type === "pace" && t.low && t.high) return (t.low + t.high) / 2;
  if (t.type === "pace" && (t.low || t.high)) return (t.low ?? t.high)!;
  return fallbackPace;
}

/** Estimated total time (sec) and distance (m) of a structure. */
export function structureTotals(
  steps: Step[],
  fallbackPaceSecPerKm = 360,
): { durationSec: number; distanceM: number } {
  let durationSec = 0;
  let distanceM = 0;
  for (const s of flattenSteps(steps)) {
    const pace = stepPace(s, fallbackPaceSecPerKm);
    if (s.duration.type === "time" && s.duration.value) {
      durationSec += s.duration.value;
      if (s.kind !== "rest") distanceM += (s.duration.value / pace) * 1000;
    } else if (s.duration.type === "distance" && s.duration.value) {
      distanceM += s.duration.value;
      durationSec += (s.duration.value / 1000) * pace;
    }
  }
  return { durationSec: Math.round(durationSec), distanceM: Math.round(distanceM) };
}

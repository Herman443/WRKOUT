import { z } from "zod";
import { sportSchema, stepSchema, workoutTypeSchema, type Step, type Sport, type WorkoutType } from "./workout-structure";

/** The fields of a planned workout that the coach (AI) writes. */
export const plannedWorkoutInputSchema = z.object({
  date: z.string().describe("YYYY-MM-DD"),
  sport: sportSchema,
  type: workoutTypeSchema,
  title: z.string().describe("Short, e.g. '6 × 800 m @ I pace'"),
  purpose: z.string().describe("One or two sentences: why this session, what it builds"),
  description: z.string().describe("How to execute it: feel, fuelling, terrain, cues"),
  key: z.boolean().describe("True for the week's key sessions (quality sessions and the long session)"),
  plannedDurationSec: z.number().nullable(),
  plannedDistanceM: z.number().nullable(),
  structure: z.array(stepSchema),
});
export type PlannedWorkoutInput = z.infer<typeof plannedWorkoutInputSchema>;

/** Minimal planned-workout view used by the pure training functions. */
export interface PlannedLite {
  id: string;
  date: string;
  sport: Sport;
  type: WorkoutType;
  title: string;
  key: boolean;
  plannedDurationSec: number | null;
  plannedDistanceM: number | null;
  structure: Step[];
  status: "planned" | "completed" | "skipped" | "missed";
}

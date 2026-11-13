import { z } from "zod";
import { addDays, startOfWeek } from "../dates";
import { plannedWorkoutInputSchema, type PlannedLite, type PlannedWorkoutInput } from "./planned";
import { QUALITY_TYPES } from "./workout-structure";

// A change set is a list of edits to upcoming planned workouts, proposed by the coach.
// Small sets are applied automatically; anything bigger waits for approval.

export const changeOpSchema = z.union([
  z.object({
    op: z.literal("modify"),
    workoutId: z.string(),
    workout: plannedWorkoutInputSchema.describe("The full replacement workout"),
  }),
  z.object({ op: z.literal("move"), workoutId: z.string(), newDate: z.string().describe("YYYY-MM-DD") }),
  z.object({ op: z.literal("add"), workout: plannedWorkoutInputSchema }),
  z.object({ op: z.literal("remove"), workoutId: z.string() }),
]);
export type ChangeOp = z.infer<typeof changeOpSchema>;

export const changeSetSchema = z.object({
  rationale: z.string().describe("Why these changes, in 1-3 sentences addressed to the athlete"),
  ops: z.array(changeOpSchema),
});
export type ChangeSet = z.infer<typeof changeSetSchema>;

export type ChangeScope = "minor" | "major";

/** Tolerated change in a week's planned time before a change set counts as major. */
const WEEK_VOLUME_TOLERANCE = 0.1;

export function classifyChanges(
  ops: ChangeOp[],
  current: PlannedLite[],
  today: string,
): { scope: ChangeScope; reasons: string[] } {
  const reasons: string[] = [];
  const byId = new Map(current.map((w) => [w.id, w]));
  const horizon = addDays(today, 6);
  const inHorizon = (d: string) => d >= today && d <= horizon;

  for (const op of ops) {
    const existing = "workoutId" in op ? byId.get(op.workoutId) : undefined;
    if ("workoutId" in op && !existing) {
      reasons.push(`Unknown workout ${op.workoutId}`);
      continue;
    }
    const dates = [
      existing?.date,
      op.op === "move" ? op.newDate : undefined,
      op.op === "modify" || op.op === "add" ? op.workout.date : undefined,
    ].filter((d): d is string => !!d);
    if (dates.some((d) => !inHorizon(d))) reasons.push("Touches workouts beyond the next 7 days");

    if (existing?.key) {
      if (op.op === "remove") reasons.push(`Removes key session "${existing.title}"`);
      if (op.op === "move") reasons.push(`Moves key session "${existing.title}"`);
      if (op.op === "modify" && QUALITY_TYPES.has(existing.type) && !QUALITY_TYPES.has(op.workout.type))
        reasons.push(`Downgrades key session "${existing.title}"`);
      if (op.op === "modify" && op.workout.date !== existing.date) reasons.push(`Moves key session "${existing.title}"`);
    }
  }

  const after = applyOps(current, ops);
  const weeks = new Set([...current, ...after].map((w) => startOfWeek(w.date)));
  for (const week of weeks) {
    const before = weekSeconds(current, week);
    const changed = weekSeconds(after, week);
    if (before > 0 && Math.abs(changed - before) / before > WEEK_VOLUME_TOLERANCE)
      reasons.push(`Week of ${week} changes by ${Math.round(((changed - before) / before) * 100)} %`);
  }

  return { scope: reasons.length ? "major" : "minor", reasons: [...new Set(reasons)] };
}

function weekSeconds(workouts: PlannedLite[], weekStart: string) {
  return workouts
    .filter((w) => startOfWeek(w.date) === weekStart && w.status !== "skipped")
    .reduce((s, w) => s + (w.plannedDurationSec ?? 0), 0);
}

/** Pure, in-memory application of ops (used for classification and previews). */
export function applyOps(current: PlannedLite[], ops: ChangeOp[]): PlannedLite[] {
  let out = current.map((w) => ({ ...w }));
  ops.forEach((op, i) => {
    switch (op.op) {
      case "remove":
        out = out.filter((w) => w.id !== op.workoutId);
        break;
      case "move":
        out = out.map((w) => (w.id === op.workoutId ? { ...w, date: op.newDate } : w));
        break;
      case "modify":
        out = out.map((w) => (w.id === op.workoutId ? { ...w, ...fromInput(op.workout), id: w.id, status: w.status } : w));
        break;
      case "add":
        out.push({ ...fromInput(op.workout), id: `new-${i}`, status: "planned" });
        break;
    }
  });
  return out;
}

function fromInput(w: PlannedWorkoutInput): Omit<PlannedLite, "id" | "status"> {
  return {
    date: w.date,
    sport: w.sport,
    type: w.type,
    title: w.title,
    key: w.key,
    plannedDurationSec: w.plannedDurationSec,
    plannedDistanceM: w.plannedDistanceM,
    structure: w.structure,
  };
}

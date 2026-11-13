import "server-only";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  athleteProfile,
  goals,
  planChanges,
  plannedWorkouts,
  plans,
  planWeeks,
  type PlannedWorkout,
  type PlanWeek,
} from "@/db/schema";
import { deriveMarkers } from "./athlete";
import { addDays, startOfWeek, todayLocal } from "./dates";
import { applyOps, classifyChanges, type ChangeOp, type ChangeSet } from "./training/changes";
import { checkWeek } from "./training/guardrails";
import { estimateWorkoutLoad } from "./training/load";
import type { PlannedLite, PlannedWorkoutInput } from "./training/planned";
import { flattenSteps, structureTotals, type WorkoutType } from "./training/workout-structure";

export async function getProfile() {
  const [p] = await db.select().from(athleteProfile).where(eq(athleteProfile.id, 1));
  return p ?? null;
}

export async function getActivePlan() {
  const [row] = await db
    .select({ goal: goals, plan: plans })
    .from(plans)
    .innerJoin(goals, eq(plans.goalId, goals.id))
    .where(inArray(plans.status, ["active", "generating"]))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getWeeks(planId: string) {
  return db.select().from(planWeeks).where(eq(planWeeks.planId, planId)).orderBy(asc(planWeeks.index));
}

export async function workoutsBetween(planId: string, from: string, to: string) {
  return db
    .select()
    .from(plannedWorkouts)
    .where(and(eq(plannedWorkouts.planId, planId), gte(plannedWorkouts.date, from), lte(plannedWorkouts.date, to)))
    .orderBy(asc(plannedWorkouts.date), asc(plannedWorkouts.createdAt));
}

export const toLite = (w: PlannedWorkout): PlannedLite => ({
  id: w.id,
  date: w.date,
  sport: w.sport,
  type: w.type as WorkoutType,
  title: w.title,
  key: w.key,
  plannedDurationSec: w.plannedDurationSec,
  plannedDistanceM: w.plannedDistanceM,
  structure: w.structure,
  status: w.status,
});

const liteToInput = (w: PlannedLite): PlannedWorkoutInput => ({ ...w, purpose: "", description: "" });

/** Normalises an AI-written workout into a row, filling totals and planned load. */
function toRow(planId: string, weekId: string | null, w: PlannedWorkoutInput, easyPace: number) {
  const totals = structureTotals(w.structure, easyPace);
  const durationSec = w.plannedDurationSec ?? (totals.durationSec || null);
  const flat = flattenSteps(w.structure).map((s) => ({
    kind: s.kind,
    zone: s.target.zone,
    durationSec:
      s.duration.type === "time"
        ? (s.duration.value ?? 0)
        : s.duration.type === "distance"
          ? ((s.duration.value ?? 0) / 1000) * (s.target.type === "pace" && s.target.low ? s.target.low : easyPace)
          : 0,
  }));
  return {
    planId,
    weekId,
    date: w.date,
    sport: w.sport,
    type: w.type,
    title: w.title,
    purpose: w.purpose,
    description: w.description,
    key: w.key,
    plannedDurationSec: durationSec ? Math.round(durationSec) : null,
    plannedDistanceM: w.plannedDistanceM ?? (w.sport === "run" && totals.distanceM ? totals.distanceM : null),
    plannedLoad: estimateWorkoutLoad(flat, w.type, durationSec),
    structure: w.structure,
    source: "ai" as const,
  };
}

async function easyPace() {
  const m = deriveMarkers(await getProfile());
  return m.zones.runPaces ? (m.zones.runPaces.easy[0] + m.zones.runPaces.easy[1]) / 2 : 360;
}

async function weekIdFor(planId: string, date: string) {
  const [w] = await db
    .select({ id: planWeeks.id })
    .from(planWeeks)
    .where(and(eq(planWeeks.planId, planId), eq(planWeeks.startDate, startOfWeek(date))));
  return w?.id ?? null;
}

/** Replaces the not-yet-done AI workouts of a week with a freshly detailed set. */
export async function replaceWeekWorkouts(planId: string, week: PlanWeek, inputs: PlannedWorkoutInput[]) {
  const today = todayLocal();
  const end = addDays(week.startDate, 6);
  const pace = await easyPace();
  const rows = inputs
    .filter((w) => w.date >= today && w.date >= week.startDate && w.date <= end)
    .map((w) => toRow(planId, week.id, w, pace));
  await db.transaction(async (tx) => {
    await tx
      .delete(plannedWorkouts)
      .where(
        and(
          eq(plannedWorkouts.weekId, week.id),
          eq(plannedWorkouts.status, "planned"),
          eq(plannedWorkouts.source, "ai"),
          gte(plannedWorkouts.date, today),
        ),
      );
    if (rows.length) await tx.insert(plannedWorkouts).values(rows);
    await tx.update(planWeeks).set({ detailStatus: "detailed" }).where(eq(planWeeks.id, week.id));
  });
}

export async function applyChangeOps(planId: string, ops: ChangeOp[]) {
  const pace = await easyPace();
  // Resolve week ids up front: queries inside the transaction must use `tx`, and a
  // second pooled query while the transaction holds a connection can deadlock.
  const dates = ops.flatMap((op) => (op.op === "move" ? [op.newDate] : op.op === "modify" || op.op === "add" ? [op.workout.date] : []));
  const weekIds = new Map<string, string | null>();
  for (const date of dates) {
    const key = startOfWeek(date);
    if (!weekIds.has(key)) weekIds.set(key, await weekIdFor(planId, date));
  }
  const weekFor = async (date: string) => weekIds.get(startOfWeek(date)) ?? null;
  await db.transaction(async (tx) => {
    for (const op of ops) {
      switch (op.op) {
        case "remove":
          await tx.delete(plannedWorkouts).where(and(eq(plannedWorkouts.id, op.workoutId), eq(plannedWorkouts.planId, planId)));
          break;
        case "move":
          await tx
            .update(plannedWorkouts)
            .set({ date: op.newDate, weekId: await weekFor(op.newDate), status: "planned" })
            .where(and(eq(plannedWorkouts.id, op.workoutId), eq(plannedWorkouts.planId, planId)));
          break;
        case "modify": {
          const row = toRow(planId, await weekFor(op.workout.date), op.workout, pace);
          await tx
            .update(plannedWorkouts)
            .set({ ...row, status: "planned" })
            .where(and(eq(plannedWorkouts.id, op.workoutId), eq(plannedWorkouts.planId, planId)));
          break;
        }
        case "add":
          await tx.insert(plannedWorkouts).values(toRow(planId, await weekFor(op.workout.date), op.workout, pace));
          break;
      }
    }
  });
}

/**
 * Applies a coach change set immediately when it is small and safe, otherwise stores it
 * as a pending proposal for the athlete to approve. `alwaysPropose` stores even small sets
 * as proposals.
 */
export async function applyOrPropose(
  planId: string,
  trigger: "activity" | "weekly_review" | "coach_note" | "missed",
  changeSet: ChangeSet,
  opts: { alwaysPropose?: boolean } = {},
) {
  if (changeSet.ops.length === 0) return null;
  const today = todayLocal();
  const current = (await workoutsBetween(planId, addDays(today, -7), addDays(today, 120))).map(toLite);
  const { scope: baseScope, reasons } = classifyChanges(changeSet.ops, current, today);
  let scope = baseScope;

  const profile = await getProfile();
  const after = applyOps(current, changeSet.ops);
  const touched = new Set(
    changeSet.ops.flatMap((op) => [
      ...("workoutId" in op ? [current.find((w) => w.id === op.workoutId)?.date] : []),
      op.op === "move" ? op.newDate : undefined,
      op.op === "modify" || op.op === "add" ? op.workout.date : undefined,
    ]),
  );
  const weeks = new Set([...touched].filter((d): d is string => !!d).map(startOfWeek));
  for (const week of weeks) {
    const inWeek = after.filter((w) => startOfWeek(w.date) === week && w.status !== "skipped" && w.date >= today);
    const { errors } = checkWeek(inWeek.map(liteToInput), {
      availableDays: profile?.availability?.days ?? [0, 1, 2, 3, 4, 5, 6],
      targetHours: null,
    });
    if (errors.length) {
      scope = "major";
      reasons.push(...errors.map((e) => `Check: ${e}`));
    }
  }

  const apply = scope === "minor" && !opts.alwaysPropose;
  const [change] = await db
    .insert(planChanges)
    .values({
      planId,
      trigger,
      scope,
      status: apply ? "applied" : "pending",
      rationale: changeSet.rationale,
      reasons,
      ops: changeSet.ops,
      decidedAt: apply ? new Date() : null,
    })
    .returning();

  if (apply) {
    try {
      await applyChangeOps(planId, changeSet.ops);
    } catch (e) {
      await db
        .update(planChanges)
        .set({ status: "failed", error: e instanceof Error ? e.message : String(e) })
        .where(eq(planChanges.id, change.id));
      return { ...change, status: "failed" as const };
    }
  }
  return change;
}

export async function decideChange(id: string, approve: boolean) {
  const [change] = await db.select().from(planChanges).where(eq(planChanges.id, id));
  if (!change || change.status !== "pending") return;
  if (!approve) {
    await db.update(planChanges).set({ status: "rejected", decidedAt: new Date() }).where(eq(planChanges.id, id));
    return;
  }
  try {
    await applyChangeOps(change.planId, change.ops);
    await db.update(planChanges).set({ status: "applied", decidedAt: new Date() }).where(eq(planChanges.id, id));
  } catch (e) {
    await db
      .update(planChanges)
      .set({ status: "failed", error: e instanceof Error ? e.message : String(e), decidedAt: new Date() })
      .where(eq(planChanges.id, id));
  }
}

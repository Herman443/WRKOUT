import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { goals, plans, planWeeks } from "@/db/schema";
import { addDays, diffDays, startOfWeek, todayLocal, WEEKDAYS } from "../dates";
import { getProfile, getWeeks, replaceWeekWorkouts } from "../plan-store";
import { checkOutline, checkWeek, type RaceInfo } from "../training/guardrails";
import { macroPlanSchema } from "../training/plan";
import { plannedWorkoutInputSchema } from "../training/planned";
import { AiError, runStructured } from "./client";
import { buildContext } from "./context";

const raceInfo = (goal: typeof goals.$inferSelect): RaceInfo => ({
  sport: goal.sport === "run" ? "run" : "bike",
  distanceM: goal.distanceM,
});

/** Step 1: phases and an outline for every week up to race day. */
export async function generateMacroPlan(planId: string): Promise<number[]> {
  const [row] = await db.select({ plan: plans, goal: goals }).from(plans).innerJoin(goals, eq(plans.goalId, goals.id)).where(eq(plans.id, planId));
  if (!row) throw new Error(`Plan ${planId} not found`);
  const { plan, goal } = row;
  const raceWeek = startOfWeek(goal.eventDate);
  const n = diffDays(plan.startDate, raceWeek) / 7 + 1;
  if (n < 1) throw new AiError("The race date is before the plan start");
  const starts = Array.from({ length: n }, (_, i) => addDays(plan.startDate, i * 7));

  const task = `Design the macro plan toward ${goal.name} on ${goal.eventDate}.

The plan has exactly ${n} weeks, indexed 0 to ${n - 1}. Week start dates in order: ${starts.join(", ")}.
The race is in the final week (index ${n - 1}, phase "race"). Today is ${todayLocal()}; week 0 may already be partly over.

Set week 0's volume from the athlete's recent training and their stated weekly workload, not from an ideal. targetHours is the total across all sports.
These checks will be applied:
- weekly hours rise by at most about 10 % (after a deload, compared with the last normal week)
- a deload at least every fourth week before the taper
- race week at or below 70 % of peak hours${raceInfo(goal).distanceM && raceInfo(goal).distanceM! >= 30000 ? "; the week before the race at or below 85 % of peak" : ""}
Give each week a one-line focus and its key sessions. Predict a realistic finish time if the plan is followed.`;

  const context = await buildContext();
  let res = await runStructured({ purpose: "macro_plan", context, task, schema: macroPlanSchema, effort: "high", maxTokens: 64000 });
  let check = checkOutline(res.data.weeks, raceInfo(goal));
  if (check.errors.length) {
    res = await runStructured({
      purpose: "macro_plan_fix",
      context,
      history: res.history,
      task: `The plan failed these checks:\n- ${check.errors.join("\n- ")}\nReturn the full corrected plan.`,
      schema: macroPlanSchema,
      effort: "high",
      maxTokens: 64000,
    });
    check = checkOutline(res.data.weeks, raceInfo(goal));
  }
  const macro = res.data;
  if (macro.weeks.length !== n) throw new AiError(`Expected ${n} weeks, got ${macro.weeks.length}`);

  await db.transaction(async (tx) => {
    await tx.delete(planWeeks).where(eq(planWeeks.planId, planId));
    await tx.insert(planWeeks).values(
      macro.weeks.map((w, i) => ({
        planId,
        index: i,
        startDate: starts[i],
        phase: w.phase,
        isDeload: w.isDeload,
        targetHours: w.targetHours,
        targetRunKm: w.targetRunKm,
        targetBikeHours: w.targetBikeHours,
        focus: w.focus,
        keySessions: w.keySessions,
      })),
    );
    await tx
      .update(plans)
      .set({
        summary: macro.summary,
        macro: { summary: macro.summary, phases: macro.phases },
        predictedFinishSec: macro.predictedFinishSec ? Math.round(macro.predictedFinishSec) : null,
        warnings: [...check.errors, ...check.warnings],
        status: "active",
        error: null,
      })
      .where(eq(plans.id, planId));
  });

  return weeksNeedingDetail(starts);
}

/** Indexes of the weeks that overlap the next 14 days. */
function weeksNeedingDetail(starts: string[]) {
  const today = todayLocal();
  const horizon = addDays(today, 13);
  return starts.flatMap((s, i) => (addDays(s, 6) >= today && s <= horizon ? [i] : []));
}

const detailSchema = z.object({
  weeks: z.array(
    z.object({
      weekIndex: z.number().int(),
      workouts: z.array(plannedWorkoutInputSchema),
    }),
  ),
});

/** Step 2: full structured workouts for specific weeks (rolling, about two weeks ahead). */
export async function detailWeeks(planId: string, weekIndexes: number[]) {
  const today = todayLocal();
  const profile = await getProfile();
  const availableDays = profile?.availability?.days ?? [0, 1, 2, 3, 4, 5, 6];
  const weeks = (await getWeeks(planId)).filter((w) => weekIndexes.includes(w.index) && addDays(w.startDate, 6) >= today);
  if (weeks.length === 0) return;

  const task = `Write the detailed workouts for these weeks:
${weeks
  .map(
    (w) =>
      `- Week ${w.index}, ${w.startDate} to ${addDays(w.startDate, 6)}: ${w.phase}${w.isDeload ? " (deload)" : ""}, target ${w.targetHours} h${w.targetRunKm ? `, ${w.targetRunKm} km running` : ""}${w.targetBikeHours ? `, ${w.targetBikeHours} h cycling` : ""}. Focus: ${w.focus}. Key sessions: ${w.keySessions.join("; ") || "your choice"}.`,
  )
  .join("\n")}

Only schedule on or after ${today}, on these days: ${availableDays.map((d) => WEEKDAYS[d]).join(", ")}.
Build on what the athlete actually did recently (see completed activities) and keep sessions they have already done out of the plan.
Every session needs a complete structure with targets from the athlete's paces and zones.
These checks will be applied per week: at most two sessions a day; at most three quality sessions (two if the week is under 4 h); no hard sessions (quality or long) on consecutive days; the long run at most about 40 % of the week's running time; weekly time close to the target.`;

  const context = await buildContext();
  const run = (history?: Awaited<ReturnType<typeof runStructured>>["history"], fix?: string) =>
    runStructured({
      purpose: fix ? "detail_weeks_fix" : "detail_weeks",
      context,
      history,
      task: fix ?? task,
      schema: detailSchema,
      effort: "high",
      maxTokens: 64000,
    });

  const validate = (data: z.infer<typeof detailSchema>) =>
    weeks.flatMap((w) => {
      const out = data.weeks.find((x) => x.weekIndex === w.index);
      if (!out) return [`Week ${w.index} is missing`];
      return checkWeek(out.workouts.filter((x) => x.date >= today), { availableDays, targetHours: w.targetHours }).errors.map(
        (e) => `Week ${w.index}: ${e}`,
      );
    });

  let res = await run();
  let errors = validate(res.data);
  if (errors.length) {
    res = await run(res.history, `These checks failed:\n- ${errors.join("\n- ")}\nReturn all requested weeks again, corrected.`);
    errors = validate(res.data);
  }

  for (const w of weeks) {
    const out = res.data.weeks.find((x) => x.weekIndex === w.index);
    if (out) await replaceWeekWorkouts(planId, w, out.workouts);
  }
  if (errors.length) {
    const [p] = await db.select({ warnings: plans.warnings }).from(plans).where(eq(plans.id, planId));
    await db
      .update(plans)
      .set({ warnings: [...(p?.warnings ?? []), ...errors].slice(-20) })
      .where(eq(plans.id, planId));
  }
}

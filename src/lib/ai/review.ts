import "server-only";
import { z } from "zod";
import { db } from "@/db";
import { analyses, kv } from "@/db/schema";
import { addDays, startOfWeek, todayLocal } from "../dates";
import { applyOrPropose, getActivePlan, getWeeks } from "../plan-store";
import { sendPush } from "../push";
import { changeSetSchema } from "../training/changes";
import { runStructured } from "./client";
import { buildContext } from "./context";

export const MARKERS = [
  "vdot",
  "ftp",
  "lthrRun",
  "lthrBike",
  "maxHr",
  "restingHr",
  "zone2PaceSecPerKm",
  "thresholdPaceSecPerKm",
] as const;
export type MarkerKey = (typeof MARKERS)[number];

export interface MarkerUpdate {
  marker: MarkerKey;
  value: number;
  reason: string;
}

const reviewSchema = z.object({
  title: z.string(),
  summary: z.string().describe("3-5 sentences: how the week went against the plan and what next week is about"),
  highlights: z.array(z.string()),
  concerns: z.array(z.string()),
  changes: changeSetSchema.describe("Adjustments to next week's workouts; empty ops if none"),
  markerUpdates: z
    .array(
      z.object({
        marker: z.enum(MARKERS),
        value: z.number(),
        reason: z.string(),
      }),
    )
    .describe("Only when this week's data clearly shows fitness markers have moved; usually empty"),
});

/** Sunday-evening review of the week; returns plan week indexes that still need detail. */
export async function weeklyReview(): Promise<number[]> {
  const active = await getActivePlan();
  if (!active) return [];
  const today = todayLocal();
  const weekStart = startOfWeek(today);

  const task = `Review the athlete's training week from ${weekStart} to ${addDays(weekStart, 6)}: what was planned against what was done, load and readiness trends, and how they are tracking toward the goal.
Then adjust next week's workouts if needed (ids from the context, dates after today). If the week's results clearly show fitness has moved (for example a threshold set run comfortably faster than target, or a power test), propose updated markers; otherwise leave markerUpdates empty.
You may check Strava for activities that are missing from the list or for longer-term comparisons.`;

  const res = await runStructured({
    purpose: "weekly_review",
    context: await buildContext({ upcomingDays: 9 }),
    task,
    schema: reviewSchema,
    effort: "high",
    useStrava: true,
    maxTokens: 32000,
  });
  const data = res.data;
  const change = data.changes.ops.length ? await applyOrPropose(active.plan.id, "weekly_review", data.changes) : null;
  await db.insert(analyses).values({
    kind: "weekly",
    title: data.title,
    summary: data.summary,
    highlights: data.highlights,
    concerns: data.concerns,
    changeId: change?.id ?? null,
  });
  if (data.markerUpdates.length) {
    const value = data.markerUpdates;
    await db.insert(kv).values({ key: "pending_marker_updates", value }).onConflictDoUpdate({ target: kv.key, set: { value } });
  }

  await sendPush({
    title: data.title,
    body: data.summary.split(/(?<=\.)\s/)[0] + (change?.status === "pending" ? " A plan change needs your OK." : ""),
    url: "/coach",
    tag: `weekly-${weekStart}`,
  });

  const horizon = addDays(today, 14);
  return (await getWeeks(active.plan.id))
    .filter((w) => w.detailStatus === "outline" && w.startDate <= horizon && addDays(w.startDate, 6) >= today)
    .map((w) => w.index);
}

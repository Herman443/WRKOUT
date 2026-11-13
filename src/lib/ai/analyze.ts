import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, analyses, plannedWorkouts } from "@/db/schema";
import { activeSec } from "../training/active-time";
import { averageIncline, isTreadmill, treadmillCorrection } from "../training/treadmill";
import { formatDuration, formatPace } from "../training/vdot";
import { changeSetSchema } from "../training/changes";
import { getActivePlan, applyOrPropose } from "../plan-store";
import { sendPush } from "../push";
import { runStructured } from "./client";
import { buildContext } from "./context";

const analysisSchema = z.object({
  title: z.string().describe("Short headline, e.g. 'Threshold set, right on pace'"),
  summary: z.string().describe("2-4 sentences on how it went and what it means"),
  score: z.number().int().nullable().describe("0-100 execution against the plan; null when unplanned"),
  highlights: z.array(z.string()),
  concerns: z.array(z.string()),
  changes: changeSetSchema.describe("Edits to upcoming workouts; use an empty ops list when the plan is on track"),
});

function describeActivity(a: typeof activities.$inferSelect) {
  const runSec = activeSec(a);
  const pace = a.sport === "run" && a.distanceM ? `, avg pace ${formatPace(runSec / (a.distanceM / 1000))}/km` : "";
  const lines = [
    `${a.localDate} ${a.sport}${a.subSport ? ` (${a.subSport})` : ""}: "${a.name}"`,
    `Duration ${formatDuration(runSec)}${a.durationSec - runSec >= 60 ? ` (${formatDuration(a.durationSec)} elapsed incl. pauses)` : ""}` +
      (a.distanceM ? `, ${(a.distanceM / 1000).toFixed(2)} km` : "") +
      pace +
      (a.elevationGainM ? `, +${Math.round(a.elevationGainM)} m` : "") +
      (pace ? ". This pace is distance over lap timer time; Strava's and Garmin's own average pace use moving time and can be faster, so quote this one" : ""),
    [
      a.avgHr && `avg HR ${a.avgHr}`,
      a.maxHr && `max HR ${a.maxHr}`,
      a.avgPowerW && `avg power ${a.avgPowerW} W`,
      a.normalizedPowerW && `NP ${a.normalizedPowerW} W`,
      a.avgCadence && `cadence ${Math.round(a.avgCadence)}`,
      a.load && `load ${Math.round(a.load)} (${a.loadMethod})`,
    ]
      .filter(Boolean)
      .join(", "),
  ];
  if (a.hrZoneSeconds) lines.push(`HR zone time Z1-Z5 (min): ${a.hrZoneSeconds.map((s) => Math.round(s / 60)).join(" / ")}`);
  if (a.laps.length)
    lines.push(
      "Laps: " +
        a.laps
          .slice(0, 40)
          .map((l, i) => {
            const p = l.distanceM ? ` ${formatPace(l.durationSec / (l.distanceM / 1000))}/km` : "";
            return `${i + 1}) ${formatDuration(l.durationSec)}, ${Math.round(l.distanceM)} m${p}${l.avgHr ? `, ${Math.round(l.avgHr)} bpm` : ""}${l.avgPower ? `, ${Math.round(l.avgPower)} W` : ""}`;
          })
          .join("; "),
    );
  const extra = a.extra as Record<string, unknown>;
  if (isTreadmill(a.subSport)) {
    const fix = treadmillCorrection(extra);
    const incline = averageIncline(a.laps);
    lines.push(
      fix
        ? `Treadmill run. Distance and lap paces come from the belt (${
            fix.method === "session"
              ? "speed and incline tracked live in the app, one lap per planned step"
              : fix.method === "laps"
                ? "speed entered per lap"
                : "treadmill's total distance"
          }${a.source === "manual" ? "; not recorded on the watch, so no heart rate" : `; the watch had guessed ${fix.originalDistanceM ? `${(fix.originalDistanceM / 1000).toFixed(2)} km` : "no distance"}`})` +
            (incline != null ? `, average incline ${incline}%` : "") +
            ". Pace targets are flat-ground paces; 1% incline roughly matches running outside."
        : "Treadmill run, not yet corrected: distance and pace are the watch's guess from arm swing and are often 5-10% off. Judge it by duration, heart rate and feel, not pace, and do not change paces or zones because of it.",
    );
  }
  if (extra.aerobicTrainingEffect) lines.push(`Garmin training effect: aerobic ${extra.aerobicTrainingEffect}, anaerobic ${extra.anaerobicTrainingEffect}`);
  if (a.rpe || a.feel || a.notes) lines.push(`Athlete feedback: ${[a.rpe && `RPE ${a.rpe}`, a.feel, a.notes].filter(Boolean).join(", ")}`);
  return lines.join("\n");
}

export async function analyzeActivity(activityId: string) {
  const [a] = await db.select().from(activities).where(eq(activities.id, activityId));
  if (!a) return;
  await db.update(activities).set({ analysisStatus: "running" }).where(eq(activities.id, activityId));

  const [planned] = a.plannedWorkoutId
    ? await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, a.plannedWorkoutId))
    : [];
  const active = await getActivePlan();

  const task = `Analyse the activity the athlete just completed and decide whether any upcoming workouts should change.

Activity
${describeActivity(a)}

${
  planned
    ? `It was planned as [${planned.id}] ${planned.type}${planned.key ? " (key session)" : ""}: "${planned.title}". Purpose: ${planned.purpose}
Planned structure: ${JSON.stringify(planned.structure)}
Automatic plan match: ${a.compliance ? `${a.compliance.score}/100 (volume ${a.compliance.volume}, intensity ${a.compliance.intensity ?? "n/a"}${a.compliance.notes.length ? `; ${a.compliance.notes.join("; ")}` : ""})` : "n/a"}`
    : "It did not match a planned workout."
}

Judge execution against the intent of the session, not only the numbers, and take readiness data into account.
Only propose changes to upcoming workouts listed in the context (ids, dates from today on). Prefer small local adjustments; leave the plan alone when it is on track.${active ? "" : "\nThere is no active plan, so return no changes."}`;

  const res = await runStructured({
    purpose: "analyze_activity",
    context: await buildContext(),
    task,
    schema: analysisSchema,
    effort: "medium",
    useStrava: true,
    maxTokens: 24000,
  });
  const data = res.data;

  const change = active && data.changes.ops.length ? await applyOrPropose(active.plan.id, "activity", data.changes) : null;
  await db.insert(analyses).values({
    kind: "activity",
    activityId,
    title: data.title,
    summary: data.summary,
    score: data.score,
    highlights: data.highlights,
    concerns: data.concerns,
    changeId: change?.id ?? null,
  });
  await db.update(activities).set({ analysisStatus: "done" }).where(eq(activities.id, activityId));

  const note =
    change?.status === "applied" ? " Upcoming workouts adjusted." : change?.status === "pending" ? " A plan change needs your OK." : "";
  await sendPush({
    title: data.title,
    body: `${data.summary.split(/(?<=\.)\s/)[0]}${note}`,
    url: `/activities/${activityId}`,
    tag: `activity-${activityId}`,
  });
}

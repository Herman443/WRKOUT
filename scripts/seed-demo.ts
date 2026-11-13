// Fills a LOCAL database with a realistic demo (profile, half-marathon plan, a few synced
// sessions with analyses, a pending proposal) so the UI can be previewed without Garmin or
// Claude. Refuses to run against anything but localhost.
// Usage: npm run seed:demo
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import * as t from "../src/db/schema";
import { addDays, startOfWeek, todayLocal } from "../src/lib/dates";
import { checkOutline } from "../src/lib/training/guardrails";
import type { WeekOutline } from "../src/lib/training/plan";
import { trainingPaces, vdotFromRace } from "../src/lib/training/vdot";
import type { Step } from "../src/lib/training/workout-structure";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("seed:demo only runs against a local DATABASE_URL");
  process.exit(1);
}

const none = { type: "none" as const, zone: null, low: null, high: null };
const today = todayLocal();
const monday = startOfWeek(today);
const vdot = vdotFromRace(10000, 44 * 60 + 30);
const p = trainingPaces(vdot);
const easy = { type: "pace" as const, zone: "Easy", low: Math.round(p.easy[0]), high: Math.round(p.easy[1]) };
const threshold = { type: "pace" as const, zone: "Threshold", low: Math.round(p.threshold - 4), high: Math.round(p.threshold + 4) };
const interval = { type: "pace" as const, zone: "Interval", low: Math.round(p.interval - 3), high: Math.round(p.interval + 3) };

const easyRun = (min: number): Step[] => [{ kind: "work", duration: { type: "time", value: min * 60 }, target: easy, note: "Conversational, Z2 heart rate" }];
const thresholdRun: Step[] = [
  { kind: "warmup", duration: { type: "time", value: 900 }, target: easy, note: null },
  {
    kind: "repeat",
    times: 4,
    steps: [
      { kind: "work", duration: { type: "time", value: 480 }, target: threshold, note: null },
      { kind: "recovery", duration: { type: "time", value: 90 }, target: none, note: "Easy jog" },
    ],
  },
  { kind: "cooldown", duration: { type: "time", value: 600 }, target: easy, note: null },
];
const intervals: Step[] = [
  { kind: "warmup", duration: { type: "time", value: 900 }, target: easy, note: "Include 4 strides" },
  {
    kind: "repeat",
    times: 6,
    steps: [
      { kind: "work", duration: { type: "distance", value: 800 }, target: interval, note: null },
      { kind: "recovery", duration: { type: "time", value: 120 }, target: none, note: "Walk or jog" },
    ],
  },
  { kind: "cooldown", duration: { type: "time", value: 600 }, target: easy, note: null },
];
const longRun = (min: number): Step[] => [
  { kind: "work", duration: { type: "time", value: (min - 15) * 60 }, target: easy, note: "Fuel every 30–40 min" },
  { kind: "work", duration: { type: "time", value: 15 * 60 }, target: { ...threshold, zone: "Marathon", low: Math.round(p.marathon - 5), high: Math.round(p.marathon + 5) }, note: "Finish steady at marathon effort" },
];

async function main() {
  for (const table of [t.analyses, t.planChanges, t.coachMessages, t.treadmillSessions, t.activities, t.plannedWorkouts, t.planWeeks, t.plans, t.goals, t.dailyHealth, t.jobs, t.kv, t.aiCalls]) {
    await db.delete(table);
  }
  await db.delete(t.athleteProfile);

  await db.insert(t.athleteProfile).values({
    id: 1,
    name: "Herman",
    sex: "male",
    birthYear: 1996,
    weightKg: 74,
    experience: "intermediate",
    maxHr: 194,
    restingHr: 46,
    lthrRun: 174,
    ftp: 255,
    zone2PaceSecPerKm: 340,
    prs: [{ label: "10K", sport: "run", distanceM: 10000, timeSec: 44 * 60 + 30, date: addDays(today, -70) }],
    availability: { days: [0, 1, 3, 4, 6], longDay: 6, weeklyHours: 5.5, weeklyRunKm: 40, weeklyBikeHours: 1, maxWeekdayMinutes: 75, strength: true },
  });

  const weeksCount = 18;
  const eventDate = addDays(monday, 7 * (weeksCount - 1) + 5);
  const [goal] = await db
    .insert(t.goals)
    .values({ sport: "run", name: "Oslo Half Marathon", eventDate, distanceM: 21097, targetTimeSec: 95 * 60 })
    .returning();
  const [plan] = await db
    .insert(t.plans)
    .values({
      goalId: goal.id,
      status: "active",
      startDate: monday,
      endDate: eventDate,
      summary:
        "Eighteen weeks from a solid 40 km base to a sub-1:35 half. Base builds easy volume with strides, build adds threshold work every week, and the last block sharpens race pace before a two-week taper.",
      predictedFinishSec: 94 * 60 + 40,
    })
    .returning();

  const hours = [5.5, 5.9, 6.3, 4.8, 6.4, 6.9, 7.3, 5.5, 7.4, 7.9, 8.3, 6.2, 8.4, 8.6, 6.6, 7.6, 5.6, 3.6];
  const phases = ["base", "base", "base", "base", "base", "build", "build", "build", "build", "build", "build", "build", "peak", "peak", "peak", "taper", "taper", "race"] as const;
  const outline: WeekOutline[] = hours.map((h, i) => ({
    index: i,
    startDate: addDays(monday, i * 7),
    phase: phases[i],
    isDeload: [3, 7, 11, 14].includes(i),
    targetHours: h,
    targetRunKm: Math.round(h * 7.2),
    targetBikeHours: null,
    focus: phases[i] === "base" ? "Easy volume, strides, one steady session" : phases[i] === "build" ? "Threshold work and a longer long run" : phases[i] === "peak" ? "Race-pace specificity" : phases[i] === "taper" ? "Freshen up, keep some intensity" : "Race week",
    keySessions: [],
  }));
  const check = checkOutline(outline, { sport: "run", distanceM: 21097 });
  console.log("Demo outline checks:", check.errors.length ? check.errors : "pass");

  const weekRows = await db
    .insert(t.planWeeks)
    .values(outline.map((w) => ({ planId: plan.id, ...w, detailStatus: (w.index < 2 ? "detailed" : "outline") as "detailed" | "outline" })))
    .returning();

  const w0 = weekRows[0].id;
  const w1 = weekRows[1].id;
  const mk = (weekId: string, offset: number, type: string, title: string, min: number, structure: Step[], key = false, purpose = "") => ({
    planId: plan.id,
    weekId,
    date: addDays(monday, offset),
    sport: "run" as const,
    type,
    title,
    purpose,
    description: "",
    key,
    plannedDurationSec: min * 60,
    plannedDistanceM: null,
    plannedLoad: Math.round(min * 0.9),
    structure,
  });
  const workouts = await db
    .insert(t.plannedWorkouts)
    .values([
      mk(w0, 0, "easy", "Easy run 45 min", 45, easyRun(45), false, "Aerobic volume. Keep it truly easy."),
      mk(w0, 1, "intervals", "6 × 800 m at interval pace", 58, intervals, true, "VO2max stimulus while legs are fresh."),
      mk(w0, 3, "easy", "Easy run 40 min", 40, easyRun(40), false, "Recovery between quality days."),
      mk(w0, 4, "threshold", "4 × 8 min at threshold", 60, thresholdRun, true, "Raises the pace you can hold for an hour. Controlled, not all-out."),
      mk(w0, 6, "long", "Long run 85 min", 85, longRun(85), true, "Durability, with a steady finish at marathon effort."),
      mk(w1, 7, "easy", "Easy run 45 min", 45, easyRun(45)),
      mk(w1, 8, "intervals", "5 × 1 km at interval pace", 60, intervals, true),
      mk(w1, 10, "easy", "Easy run 45 min", 45, easyRun(45)),
      mk(w1, 11, "threshold", "3 × 12 min at threshold", 65, thresholdRun, true),
      mk(w1, 13, "long", "Long run 95 min", 95, longRun(95), true),
    ])
    .returning();

  // Past sessions this week: Monday and Tuesday done, Thursday missed (if already past).
  const done = workouts.filter((w) => w.date < today && (w.type === "intervals" || w.title.startsWith("Easy run 45")) && w.weekId === w0);
  for (const w of done) {
    const isIntervals = w.type === "intervals";
    const start = new Date(`${w.date}T06:30:00Z`);
    const laps = isIntervals
      ? [{ durationSec: 900, distanceM: 2750 }, ...Array.from({ length: 6 }, () => [{ durationSec: 189, distanceM: 800, avgHr: 176 }, { durationSec: 120, distanceM: 260, avgHr: 150 }]).flat(), { durationSec: 600, distanceM: 1800 }]
      : Array.from({ length: 8 }, () => ({ durationSec: 335, distanceM: 1000, avgHr: 142 }));
    const [a] = await db
      .insert(t.activities)
      .values({
        garminId: `demo-${w.id.slice(0, 8)}`,
        source: "garmin",
        startTime: start,
        localDate: w.date,
        sport: "run",
        subSport: "running",
        name: isIntervals ? "Morning intervals" : "Morning run",
        durationSec: isIntervals ? 3534 : 2700,
        movingSec: isIntervals ? 3480 : 2680,
        distanceM: isIntervals ? 10700 : 8020,
        avgHr: isIntervals ? 158 : 142,
        maxHr: isIntervals ? 183 : 151,
        load: isIntervals ? 78 : 42,
        loadMethod: "pace",
        laps,
        hrZoneSeconds: isIntervals ? [600, 1300, 500, 700, 434] : [500, 2050, 150, 0, 0],
        plannedWorkoutId: w.id,
        compliance: isIntervals ? { score: 94, volume: 100, intensity: 96, notes: [] } : { score: 100, volume: 100, intensity: 100, notes: [] },
        analysisStatus: "done",
        rpe: isIntervals ? 8 : 3,
      })
      .returning();
    await db.update(t.plannedWorkouts).set({ status: "completed", activityId: a.id }).where(eq(t.plannedWorkouts.id, w.id));
    await db.insert(t.analyses).values({
      kind: "activity",
      activityId: a.id,
      title: isIntervals ? "800s right on pace" : "Easy run kept easy",
      summary: isIntervals
        ? "All six reps landed between 3:55 and 3:58 per km with even splits, and heart rate recovered well between them. That's a clear sign your interval pace is set correctly. Keep Friday's threshold session controlled."
        : "Ninety percent of the run sat in Z1–Z2, exactly what an easy day should look like.",
      score: isIntervals ? 94 : 98,
      highlights: isIntervals ? ["Even splits across all six reps", "Fast heart-rate recovery between reps"] : ["Disciplined pacing"],
      concerns: isIntervals ? ["RPE 8 is on the high side for rep three onward; sleep tonight matters"] : [],
    });
  }

  await db.insert(t.analyses).values({
    kind: "weekly",
    title: "Solid first week back in structure",
    summary: "You hit both key sessions and kept the easy days easy. Load is rising gently (ACWR 1.08). Next week adds a little threshold volume and a ten-minute longer long run.",
    highlights: ["Both key sessions done", "Easy days in Z2"],
    concerns: [],
  });

  const long = workouts.find((w) => w.type === "long" && w.weekId === w0)!;
  await db.insert(t.planChanges).values({
    planId: plan.id,
    trigger: "coach_note",
    scope: "major",
    status: "pending",
    rationale: "You mentioned travelling on Sunday, so the long run moves to Saturday and Friday's threshold set gets lighter to keep a day between hard efforts.",
    reasons: ["Moves key session \"Long run 85 min\""],
    ops: [{ op: "move", workoutId: long.id, newDate: addDays(monday, 5) }],
  });
  await db.insert(t.coachMessages).values([
    { role: "user", content: "I'm travelling Sunday morning, can we shift the long run?", createdAt: new Date(Date.now() - 3600_000) },
    { role: "coach", content: "Yes. I'd move it to Saturday and soften Friday's threshold set so you still get a day between hard efforts. Have a look at the proposal above.", createdAt: new Date(Date.now() - 3500_000) },
  ]);
  await db.insert(t.dailyHealth).values({ date: today, sleepSec: 7 * 3600 + 25 * 60, sleepScore: 81, hrvMs: 62, hrvStatus: "BALANCED", restingHr: 46, bodyBattery: 78 });

  console.log(`Seeded demo plan to ${eventDate} with ${workouts.length} workouts.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Generates a real plan against the local database and prints it with guardrail results
// and cost. Uses your saved profile, or a sample one if none exists.
// Usage: npm run try:plan -- 2027-04-25 21097   (event date, distance in metres)
import { desc, eq, gte } from "drizzle-orm";
import { db } from "../src/db";
import { aiCalls, athleteProfile, goals, plans } from "../src/db/schema";
import { detailWeeks, generateMacroPlan } from "../src/lib/ai/plan";
import { addDays, startOfWeek, todayLocal, weekday } from "../src/lib/dates";
import { getProfile, getWeeks, workoutsBetween } from "../src/lib/plan-store";
import { compactDuration } from "../src/lib/training/vdot";

async function main() {
  const started = new Date();
  const today = todayLocal();
  const eventDate = process.argv[2] ?? addDays(today, 7 * 16);
  const distanceM = Number(process.argv[3] ?? 21097);

  if (!(await getProfile())) {
    await db.insert(athleteProfile).values({
      id: 1,
      name: "Sample athlete",
      experience: "intermediate",
      maxHr: 192,
      restingHr: 48,
      lthrRun: 172,
      prs: [{ label: "10K", sport: "run", distanceM: 10000, timeSec: 44 * 60 + 30, date: addDays(today, -60) }],
      availability: { days: [0, 1, 3, 5, 6], longDay: 6, weeklyHours: 5, weeklyRunKm: 35, weeklyBikeHours: null, maxWeekdayMinutes: 75, strength: true },
    });
    console.log("Created a sample profile.");
  }

  await db.update(plans).set({ status: "archived" }).where(eq(plans.status, "active"));
  const [goal] = await db.insert(goals).values({ sport: "run", name: "Test race", eventDate, distanceM }).returning();
  const startDate = weekday(today) <= 2 ? startOfWeek(today) : addDays(startOfWeek(today), 7);
  const [plan] = await db.insert(plans).values({ goalId: goal.id, startDate, endDate: eventDate }).returning();

  console.log(`Generating macro plan to ${eventDate}…`);
  const detail = await generateMacroPlan(plan.id);
  const weeks = await getWeeks(plan.id);
  for (const w of weeks) console.log(`  ${String(w.index).padStart(2)} ${w.startDate} ${w.phase.padEnd(7)} ${w.isDeload ? "deload " : "       "}${w.targetHours} h  ${w.focus}`);
  const [saved] = await db.select().from(plans).where(eq(plans.id, plan.id));
  if (saved.warnings.length) console.log("Checks:", saved.warnings);

  console.log(`\nDetailing weeks ${detail.join(", ")}…`);
  await detailWeeks(plan.id, detail);
  for (const w of await workoutsBetween(plan.id, today, addDays(today, 14)))
    console.log(`  ${w.date} ${w.type.padEnd(10)} ${w.plannedDurationSec ? compactDuration(w.plannedDurationSec) : ""}  ${w.title}`);

  const calls = await db.select().from(aiCalls).where(gte(aiCalls.createdAt, started)).orderBy(desc(aiCalls.createdAt));
  const cost = calls.reduce((s, c) => s + c.costUsd, 0);
  console.log(`\n${calls.length} Claude calls, $${cost.toFixed(3)} total`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

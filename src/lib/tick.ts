import "server-only";
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { plannedWorkouts } from "@/db/schema";
import { addDays, diffDays, localTime, startOfWeek, todayLocal, weekday } from "./dates";
import { env } from "./env";
import { fetchDailyHealth, getKv, pollGarmin, setKv } from "./ingest";
import { enqueue, hasOpenJob, kickWorker } from "./jobs";
import { getActivePlan, getWeeks, workoutsBetween } from "./plan-store";
import { sendPush } from "./push";
import { formatDuration } from "./training/vdot";

/** Everything the 15-minute scheduler does. Each step is independent and failure-tolerant. */
export async function tick(now = new Date()) {
  const today = todayLocal(now);
  const { hour } = localTime(now);
  const log: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      log[name] = (await fn()) ?? "ok";
    } catch (e) {
      console.error(`tick step ${name} failed`, e);
      log[name] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  };

  if (env.garminApiKey && hour >= 5) await step("garmin", async () => (await pollGarmin()).length);

  if (env.garminApiKey && hour >= 7 && (await getKv<string>("health_date")) !== today) {
    await step("health", async () => {
      await fetchDailyHealth(today);
      await setKv("health_date", today);
    });
  }

  const active = await getActivePlan();

  if (active && hour >= 7 && hour < 10 && (await getKv<string>("morning_push_date")) !== today) {
    await step("morning", async () => {
      await setKv("morning_push_date", today);
      const todays = (await workoutsBetween(active.plan.id, today, today)).filter((w) => w.status === "planned");
      if (todays.length === 0) return sendPush({ title: "Rest day", body: "Nothing planned today. Recover well.", url: "/", tag: "today" });
      const main = todays[0];
      const more = todays.length > 1 ? ` (+${todays.length - 1} more)` : "";
      return sendPush({
        title: `Today: ${main.title}`,
        body: `${main.plannedDurationSec ? formatDuration(main.plannedDurationSec) : ""}${more}. ${main.purpose}`.trim(),
        url: `/workout/${main.id}`,
        tag: "today",
      });
    });
  }

  if (active && hour >= 5) {
    await step("missed", async () => {
      const overdue = await db
        .select()
        .from(plannedWorkouts)
        .where(
          and(
            eq(plannedWorkouts.planId, active.plan.id),
            eq(plannedWorkouts.status, "planned"),
            lt(plannedWorkouts.date, today),
            gte(plannedWorkouts.date, addDays(today, -14)),
          ),
        );
      if (overdue.length === 0) return 0;
      for (const w of overdue) await db.update(plannedWorkouts).set({ status: "missed" }).where(eq(plannedWorkouts.id, w.id));
      const recent = overdue.filter((w) => diffDays(w.date, today) <= 2);
      if (recent.length) {
        const list = recent.map((w) => `${w.date}: ${w.title}${w.key ? " (key session)" : ""}`).join("; ");
        await enqueue("coach_note", { trigger: "missed", text: `These planned sessions were not completed: ${list}.` });
      }
      return overdue.length;
    });
  }

  if (active && weekday(today) === 6 && hour >= 18 && (await getKv<string>("weekly_review_week")) !== startOfWeek(today)) {
    await step("weekly_review", async () => {
      await setKv("weekly_review_week", startOfWeek(today));
      await enqueue("weekly_review", { planId: active.plan.id });
    });
  }

  if (active?.plan.status === "active") {
    await step("detail", async () => {
      const horizon = addDays(today, 9);
      const missing = (await getWeeks(active.plan.id))
        .filter((w) => w.detailStatus === "outline" && w.startDate <= horizon && addDays(w.startDate, 6) >= today)
        .map((w) => w.index);
      if (missing.length && !(await hasOpenJob("detail_weeks")) && !(await hasOpenJob("weekly_review"))) {
        await enqueue("detail_weeks", { planId: active.plan.id, weekIndexes: missing });
      }
      return missing;
    });
  }

  const keyExpires = process.env.GARMIN_API_KEY_EXPIRES;
  if (keyExpires && diffDays(today, keyExpires) <= 14 && (await getKv<string>("garmin_key_warned")) !== keyExpires) {
    await step("garmin_key", async () => {
      await setKv("garmin_key_warned", keyExpires);
      await sendPush({
        title: "Garmin key expires soon",
        body: `Your Garmin Personal API key expires on ${keyExpires}. Create a new one in Garmin Connect and update GARMIN_API_KEY.`,
        url: "/settings",
        tag: "garmin-key",
      });
    });
  }

  await kickWorker();
  return log;
}

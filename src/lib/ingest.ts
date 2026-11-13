import "server-only";
import { and, between, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, dailyHealth, kv, plannedWorkouts, type Activity } from "@/db/schema";
import { deriveMarkers } from "./athlete";
import { addDays, toLocalDate, todayLocal } from "./dates";
import { garmin, type GarminActivitySummary } from "./garmin/client";
import { parseFit } from "./garmin/fit";
import { mapActivitySummary } from "./garmin/map";
import { enqueue } from "./jobs";
import { getActivePlan, getProfile, toLite, workoutsBetween } from "./plan-store";
import { computeCompliance } from "./training/compliance";
import { activityLoad } from "./training/load";
import { matchActivity } from "./training/matching";
import { sportSchema } from "./training/workout-structure";

// Activities only get an automatic AI analysis when they are this recent; older ones
// (first sync, backfill) are logged for load history without spending tokens.
const ANALYZE_WITHIN_DAYS = 2;
const BACKFILL_DAYS = 42;

async function getKv<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(kv).where(eq(kv.key, key));
  return (row?.value as T | undefined) ?? null;
}

export async function setKv(key: string, value: unknown) {
  await db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } });
}

export { getKv };

/** Pulls new activities from Garmin. Returns the ids of activities that were added. */
export async function pollGarmin(): Promise<string[]> {
  const last = await getKv<{ at: number }>("garmin_last_poll");
  const since = last ? addDays(toLocalDate(new Date(last.at)), -2) : addDays(todayLocal(), -BACKFILL_DAYS);
  const added: string[] = [];
  for (let start = 0; start < 200; start += 50) {
    const page = (await garmin.searchActivities({ startDate: since, endDate: todayLocal(), start, limit: 50 })) ?? [];
    for (const summary of page) {
      const id = await ingestGarminActivity(summary);
      if (id) added.push(id);
    }
    if (page.length < 50) break;
  }
  await setKv("garmin_last_poll", { at: Date.now() });
  return added;
}

async function ingestGarminActivity(summary: GarminActivitySummary): Promise<string | null> {
  const garminId = String(summary.activityId);
  const [existing] = await db.select({ id: activities.id }).from(activities).where(eq(activities.garminId, garminId));
  if (existing) return null;

  const mapped = mapActivitySummary(summary);
  const profile = await getProfile();
  const markers = deriveMarkers(profile);

  let laps: Activity["laps"] = [];
  let zoneSeconds = mapped.hrZoneSeconds;
  let np = mapped.normalizedPowerW;
  try {
    const fit = parseFit(await garmin.downloadActivity(garminId), mapped.sport === "bike" ? markers.zones.bikeHr : markers.zones.runHr);
    laps = fit.laps;
    zoneSeconds = fit.hrZoneSeconds ?? zoneSeconds;
    np = np ?? (fit.normalizedPowerW ? Math.round(fit.normalizedPowerW) : null);
  } catch (e) {
    console.warn(`FIT download/parse failed for ${garminId}`, e);
  }

  const load = activityLoad(
    {
      sport: mapped.sport,
      durationSec: mapped.movingSec ?? mapped.durationSec,
      distanceM: mapped.distanceM,
      avgHr: mapped.avgHr,
      normalizedPower: np,
      avgPower: mapped.avgPowerW,
    },
    { ...markers.load, lthr: mapped.sport === "bike" ? (profile?.lthrBike ?? markers.load.lthr) : markers.load.lthr },
  );

  // A Strava-only placeholder for the same session gets upgraded with Garmin's data.
  const window = 2 * 60 * 1000;
  const [stravaTwin] = await db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.source, "strava"),
        between(activities.startTime, new Date(mapped.startTime.getTime() - window), new Date(mapped.startTime.getTime() + window)),
      ),
    );

  const values = {
    ...mapped,
    normalizedPowerW: np,
    laps,
    hrZoneSeconds: zoneSeconds,
    load: load.value,
    loadMethod: load.method,
  };
  const recent = mapped.localDate >= addDays(todayLocal(), -ANALYZE_WITHIN_DAYS);

  if (stravaTwin) {
    await db.update(activities).set({ ...values, source: "garmin" }).where(eq(activities.id, stravaTwin.id));
    return null;
  }

  const [row] = await db
    .insert(activities)
    .values({ ...values, analysisStatus: recent ? "pending" : "skipped" })
    .returning();
  await linkToPlan(row);
  if (recent) await enqueue("analyze_activity", { activityId: row.id });
  return row.id;
}

/** Matches an activity to a planned workout and records plan compliance. */
async function linkToPlan(a: Activity) {
  const active = await getActivePlan();
  if (!active) return;
  const candidates = await workoutsBetween(active.plan.id, addDays(a.localDate, -1), addDays(a.localDate, 1));
  const match = matchActivity({ sport: a.sport, date: a.localDate, durationSec: a.movingSec ?? a.durationSec }, candidates.map(toLite));
  if (!match) return;
  const compliance = computeCompliance(match, {
    durationSec: a.movingSec ?? a.durationSec,
    distanceM: a.distanceM,
    laps: a.laps,
    hrZoneSeconds: a.hrZoneSeconds,
  });
  await db.update(activities).set({ plannedWorkoutId: match.id, compliance }).where(eq(activities.id, a.id));
  await db.update(plannedWorkouts).set({ status: "completed", activityId: a.id }).where(eq(plannedWorkouts.id, match.id));
}

/** Sleep, HRV, resting HR and body battery for one morning. */
export async function fetchDailyHealth(date: string) {
  const [sleep, hrv, summaries] = await Promise.all([
    garmin.dailySleep(date),
    garmin.dailyHrv(date),
    garmin.dailySummaries(date, date),
  ]);
  // Response shapes aren't formally documented, so read defensively.
  const s = obj(sleep);
  const dto = obj(s.dailySleepDTO ?? s);
  const h = obj(obj(hrv).hrvSummary);
  const sumList = (Array.isArray(summaries) ? summaries : (obj(summaries).data ?? [])) as unknown[];
  const days = sumList.map(obj);
  const day = days.find((d) => (d.calendarDate ?? d.date) === date) ?? days[0] ?? {};

  const row = {
    date,
    sleepSec: num(dto.sleepTimeSeconds),
    sleepScore: num(obj(obj(dto.sleepScores).overall).value ?? dto.sleepScore),
    hrvMs: num(h.lastNightAvg ?? s.avgOvernightHrv),
    hrvStatus: typeof h.status === "string" ? h.status : typeof s.hrvStatus === "string" ? s.hrvStatus : null,
    restingHr: num(day.restingHeartRate ?? s.restingHeartRate),
    bodyBattery: num(day.bodyBatteryHighestValue ?? day.bodyBatteryAtWakeTime ?? s.bodyBatteryChange),
    stress: num(day.averageStressLevel),
    raw: { sleepTimeSeconds: dto.sleepTimeSeconds ?? null, hrv: h, day },
  };
  await db.insert(dailyHealth).values(row).onConflictDoUpdate({ target: dailyHealth.date, set: row });
  return row;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * Strava webhook follow-up. Activities recorded on the watch reach Strava via Garmin, so
 * first try to pair the event with a Garmin activity; only sessions recorded outside
 * Garmin are read — through Claude and Strava's MCP server, never the Strava API.
 */
export async function ingestStravaActivity(stravaId: string, eventTimeSec: number) {
  const [known] = await db.select({ id: activities.id }).from(activities).where(eq(activities.stravaId, stravaId));
  if (known) return;

  await pollGarmin();
  const eventTime = new Date(eventTimeSec * 1000);
  const [candidate] = await db
    .select()
    .from(activities)
    .where(
      and(
        isNull(activities.stravaId),
        eq(activities.source, "garmin"),
        between(activities.startTime, new Date(eventTime.getTime() - 12 * 3600 * 1000), eventTime),
      ),
    )
    .orderBy(desc(activities.startTime))
    .limit(1);
  if (candidate && candidate.startTime.getTime() + candidate.durationSec * 1000 <= eventTime.getTime() + 10 * 60 * 1000) {
    await db.update(activities).set({ stravaId }).where(eq(activities.id, candidate.id));
    return;
  }

  const { runStructured } = await import("./ai/client");
  const { buildContext } = await import("./ai/context");
  const res = await runStructured({
    purpose: "strava_activity",
    context: await buildContext({ upcomingDays: 2 }),
    task: `Use the Strava tools to look up the athlete's Strava activity with id ${stravaId}. Return its basic facts. If you cannot find it, set found to false.`,
    schema: stravaFactsSchema,
    effort: "low",
    useStrava: true,
    maxTokens: 8000,
  });
  if (!res.usedStrava || !res.data.found || !res.data.startTimeIso) return;
  const f = res.data;
  const start = new Date(f.startTimeIso!);
  const [row] = await db
    .insert(activities)
    .values({
      stravaId,
      source: "strava",
      startTime: start,
      localDate: toLocalDate(start),
      sport: f.sport,
      name: f.name,
      durationSec: Math.round(f.durationSec),
      distanceM: f.distanceM,
      elevationGainM: f.elevationGainM,
      avgHr: f.avgHr ? Math.round(f.avgHr) : null,
      maxHr: f.maxHr ? Math.round(f.maxHr) : null,
      avgPowerW: f.avgPowerW ? Math.round(f.avgPowerW) : null,
      analysisStatus: "pending",
    })
    .returning();
  const markers = deriveMarkers(await getProfile());
  const load = activityLoad({ sport: row.sport, durationSec: row.durationSec, distanceM: row.distanceM, avgHr: row.avgHr, avgPower: row.avgPowerW }, markers.load);
  await db.update(activities).set({ load: load.value, loadMethod: load.method }).where(eq(activities.id, row.id));
  await linkToPlan({ ...row, load: load.value });
  await enqueue("analyze_activity", { activityId: row.id });
}

const stravaFactsSchema = z.object({
  found: z.boolean(),
  sport: sportSchema,
  name: z.string(),
  startTimeIso: z.string().nullable().describe("Start time as ISO 8601 with offset"),
  durationSec: z.number(),
  distanceM: z.number().nullable(),
  elevationGainM: z.number().nullable(),
  avgHr: z.number().nullable(),
  maxHr: z.number().nullable(),
  avgPowerW: z.number().nullable(),
});

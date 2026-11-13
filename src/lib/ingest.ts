import "server-only";
import { and, between, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  activities,
  dailyHealth,
  kv,
  plannedWorkouts,
  treadmillSessions,
  type Activity,
  type AthleteProfile,
  type TreadmillSession,
} from "@/db/schema";
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
import { climbM, equivalentFlatDistance, isTreadmill, paceTrusted, treadmillCorrection, type TreadmillCorrection } from "./training/treadmill";
import { lapsFromSegments, overlapShare, withHeartRate, type Segment } from "./training/treadmill-live";
import { sportSchema } from "./training/workout-structure";

// Activities only get an automatic AI analysis when they are this recent; older ones
// (first sync, backfill) are logged for load history without spending tokens.
export const ANALYZE_WITHIN_DAYS = 2;
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
  let hrSamples: [number, number][] = [];
  let zoneSeconds = mapped.hrZoneSeconds;
  let np = mapped.normalizedPowerW;
  try {
    const fit = parseFit(await garmin.downloadActivity(garminId), mapped.sport === "bike" ? markers.zones.bikeHr : markers.zones.runHr);
    laps = fit.laps;
    hrSamples = fit.hrSamples;
    zoneSeconds = fit.hrZoneSeconds ?? zoneSeconds;
    np = np ?? (fit.normalizedPowerW ? Math.round(fit.normalizedPowerW) : null);
  } catch (e) {
    console.warn(`FIT download/parse failed for ${garminId}`, e);
  }

  const load = loadFor({ ...mapped, normalizedPowerW: np, laps, rpe: null }, profile);

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
  const session = await sessionFor(row);
  if (session) await applyTreadmillSession(session, row.id, hrSamples);
  if (recent) await enqueue("analyze_activity", { activityId: row.id });
  return row.id;
}

type LoadFields = Pick<
  Activity,
  "sport" | "subSport" | "durationSec" | "movingSec" | "distanceM" | "laps" | "extra" | "avgHr" | "normalizedPowerW" | "avgPowerW" | "rpe"
>;

/**
 * Training load for an activity. A treadmill run's watch distance is a guess, so its load
 * comes from heart rate until the belt numbers are entered; then incline counts as effort.
 */
function loadFor(a: LoadFields, profile: AthleteProfile | null | undefined) {
  const markers = deriveMarkers(profile);
  const treadmill = isTreadmill(a.subSport);
  const distanceM = !treadmill ? a.distanceM : paceTrusted(a) ? (a.laps.length ? equivalentFlatDistance(a.laps) : a.distanceM) : null;
  return activityLoad(
    {
      sport: a.sport,
      durationSec: a.movingSec ?? a.durationSec,
      distanceM,
      avgHr: a.avgHr,
      normalizedPower: a.normalizedPowerW,
      avgPower: a.avgPowerW,
      rpe: a.rpe,
    },
    { ...markers.load, lthr: a.sport === "bike" ? (profile?.lthrBike ?? markers.load.lthr) : markers.load.lthr },
  );
}

const complianceInput = (a: Activity) => ({
  durationSec: a.movingSec ?? a.durationSec,
  distanceM: a.distanceM,
  laps: a.laps,
  hrZoneSeconds: a.hrZoneSeconds,
  paceTrusted: paceTrusted(a),
});

/** Matches an activity to a planned workout and records plan compliance. */
async function linkToPlan(a: Activity) {
  const active = await getActivePlan();
  if (!active) return;
  const candidates = await workoutsBetween(active.plan.id, addDays(a.localDate, -1), addDays(a.localDate, 1));
  const match = matchActivity({ sport: a.sport, date: a.localDate, durationSec: a.movingSec ?? a.durationSec }, candidates.map(toLite));
  if (!match) return;
  const compliance = computeCompliance(match, complianceInput(a));
  await db.update(activities).set({ plannedWorkoutId: match.id, compliance }).where(eq(activities.id, a.id));
  await db.update(plannedWorkouts).set({ status: "completed", activityId: a.id }).where(eq(plannedWorkouts.id, match.id));
}

/** Links an activity to a specific planned workout, releasing any workout it matched before. */
async function linkToWorkout(a: Activity, workoutId: string) {
  if (a.plannedWorkoutId === workoutId) return;
  if (a.plannedWorkoutId)
    await db
      .update(plannedWorkouts)
      .set({ status: "planned", activityId: null })
      .where(and(eq(plannedWorkouts.id, a.plannedWorkoutId), eq(plannedWorkouts.activityId, a.id)));
  await db.update(activities).set({ plannedWorkoutId: workoutId }).where(eq(activities.id, a.id));
  await db.update(plannedWorkouts).set({ status: "completed", activityId: a.id }).where(eq(plannedWorkouts.id, workoutId));
}

/** Recomputes load and plan match after an activity's numbers changed (e.g. a treadmill correction). */
export async function rescoreActivity(id: string) {
  const [a] = await db.select().from(activities).where(eq(activities.id, id));
  if (!a) return;
  const load = loadFor(a, await getProfile());
  const [planned] = a.plannedWorkoutId ? await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, a.plannedWorkoutId)) : [];
  const compliance = planned ? computeCompliance(toLite(planned), complianceInput(a)) : a.compliance;
  await db.update(activities).set({ load: load.value, loadMethod: load.method, compliance }).where(eq(activities.id, id));
}

// ---------- treadmill sessions tracked live in the app ----------

const HOUR = 3600 * 1000;
const span = (start: Date, sec: number): [number, number] => [start.getTime(), start.getTime() + sec * 1000];
const sessionSpan = (s: TreadmillSession): [number, number] => [s.startedAt.getTime(), s.endedAt.getTime()];

/** A session waiting for the watch whose time matches a run that just synced. */
async function sessionFor(a: Activity): Promise<TreadmillSession | null> {
  if (a.sport !== "run") return null;
  const [start, end] = span(a.startTime, a.durationSec);
  const rows = await db
    .select()
    .from(treadmillSessions)
    .where(and(isNull(treadmillSessions.activityId), between(treadmillSessions.startedAt, new Date(start - 12 * HOUR), new Date(end))));
  return rows.find((s) => overlapShare([start, end], sessionSpan(s)) >= 0.5) ?? null;
}

/** The watch's run for a session, when it has already synced. */
async function activityFor(s: TreadmillSession): Promise<Activity | null> {
  const [start, end] = sessionSpan(s);
  const rows = await db
    .select()
    .from(activities)
    .where(and(eq(activities.sport, "run"), between(activities.startTime, new Date(start - 12 * HOUR), new Date(end))));
  return (
    rows.find(
      (a) =>
        a.source !== "manual" &&
        treadmillCorrection(a.extra)?.method !== "session" &&
        overlapShare(span(a.startTime, a.durationSec), [start, end]) >= 0.5,
    ) ?? null
  );
}

/**
 * Puts a session's belt data onto the watch's run: laps per step (with the watch's heart
 * rate), distance, incline and climb. The watch's own numbers are kept for undoing.
 */
async function applyTreadmillSession(s: TreadmillSession, activityId: string, hrSamples: [number, number][]) {
  const [a] = await db.select().from(activities).where(eq(activities.id, activityId));
  if (!a) return;
  const laps = withHeartRate(lapsFromSegments(s.segments), hrSamples);
  const previous = treadmillCorrection(a.extra);
  const correction: TreadmillCorrection = {
    method: "session",
    originalDistanceM: previous ? previous.originalDistanceM : a.distanceM,
    originalElevationGainM: previous ? previous.originalElevationGainM : a.elevationGainM,
    originalLaps: previous ? previous.originalLaps : a.laps,
    correctedAt: new Date().toISOString(),
  };
  await db
    .update(activities)
    .set({
      laps,
      distanceM: laps.reduce((sum, l) => sum + l.distanceM, 0),
      elevationGainM: Math.round(climbM(laps)),
      // Recorded as an ordinary run on the watch, but the session shows it was on a belt.
      subSport: isTreadmill(a.subSport) ? a.subSport : "treadmill_running",
      extra: { ...a.extra, treadmill: correction },
    })
    .where(eq(activities.id, a.id));
  if (s.plannedWorkoutId) await linkToWorkout(a, s.plannedWorkoutId);
  await db.update(treadmillSessions).set({ activityId: a.id }).where(eq(treadmillSessions.id, s.id));
  await rescoreActivity(a.id);
}

/** The session is the only record of the run, so it becomes an activity of its own. */
async function logSessionAsActivity(s: TreadmillSession) {
  const laps = withHeartRate(lapsFromSegments(s.segments), []);
  const [planned] = s.plannedWorkoutId ? await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, s.plannedWorkoutId)) : [];
  const correction: TreadmillCorrection = {
    method: "session",
    originalDistanceM: null,
    originalElevationGainM: null,
    originalLaps: [],
    correctedAt: new Date().toISOString(),
  };
  const [row] = await db
    .insert(activities)
    .values({
      source: "manual",
      startTime: s.startedAt,
      localDate: toLocalDate(s.startedAt),
      sport: "run",
      subSport: "treadmill_running",
      name: planned?.title ?? "Treadmill run",
      durationSec: Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 1000),
      movingSec: laps.reduce((sum, l) => sum + l.durationSec, 0),
      distanceM: laps.reduce((sum, l) => sum + l.distanceM, 0),
      elevationGainM: Math.round(climbM(laps)),
      laps,
      extra: { treadmill: correction },
      analysisStatus: "pending",
    })
    .returning();
  if (planned) await linkToWorkout(row, planned.id);
  else await linkToPlan(row);
  await db.update(treadmillSessions).set({ activityId: row.id }).where(eq(treadmillSessions.id, s.id));
  await rescoreActivity(row.id);
  await enqueue("analyze_activity", { activityId: row.id });
  return row.id;
}

/**
 * Stores a finished treadmill session. If the watch's run has already synced it is updated
 * now (and re-analysed); otherwise that happens when it syncs. Returns the activity id when
 * there is one already.
 */
export async function saveTreadmillSession(input: {
  id: string;
  plannedWorkoutId: string | null;
  segments: Segment[];
  recordedOnWatch: boolean;
}) {
  const segments = input.segments.filter((x) => x.endMs > x.startMs);
  if (!segments.length) return null;
  const [session] = await db
    .insert(treadmillSessions)
    .values({
      id: input.id,
      plannedWorkoutId: input.plannedWorkoutId,
      startedAt: new Date(Math.min(...segments.map((x) => x.startMs))),
      endedAt: new Date(Math.max(...segments.map((x) => x.endMs))),
      segments,
      recordedOnWatch: input.recordedOnWatch,
    })
    .onConflictDoNothing()
    .returning();
  if (!session) {
    // Saved already; the phone just never heard back.
    const [known] = await db.select().from(treadmillSessions).where(eq(treadmillSessions.id, input.id));
    return known?.activityId ?? null;
  }
  if (!input.recordedOnWatch) return logSessionAsActivity(session);

  const a = await activityFor(session);
  if (!a) return null;
  let hr: [number, number][] = [];
  try {
    if (a.garminId) hr = parseFit(await garmin.downloadActivity(a.garminId)).hrSamples;
  } catch (e) {
    console.warn(`FIT download failed for ${a.garminId}; treadmill laps get no heart rate`, e);
  }
  await applyTreadmillSession(session, a.id, hr);
  if (a.analysisStatus !== "pending" && a.analysisStatus !== "skipped") {
    await db.update(activities).set({ analysisStatus: "pending" }).where(eq(activities.id, a.id));
    await enqueue("analyze_activity", { activityId: a.id });
  }
  return a.id;
}

/** Sessions whose watch run never arrived (not synced, or not recorded after all) are logged on their own. */
export async function logUnsyncedTreadmillSessions(now = new Date()) {
  const stale = await db
    .select()
    .from(treadmillSessions)
    .where(
      and(
        isNull(treadmillSessions.activityId),
        lt(treadmillSessions.endedAt, new Date(now.getTime() - 3 * HOUR)),
        gte(treadmillSessions.endedAt, new Date(now.getTime() - 7 * 24 * HOUR)),
      ),
    );
  for (const s of stale) await logSessionAsActivity(s);
  return stale.length;
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
 * Garmin are read — through Claude and Strava's MCP server, never the Strava API. (Strava
 * currently refuses WRKOUT's MCP client, so the Claude app connector's import tool is the
 * working route.)
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
  await importStravaActivity({
    stravaId,
    sport: f.sport,
    name: f.name,
    startTime: new Date(f.startTimeIso!),
    durationSec: f.durationSec,
    distanceM: f.distanceM,
    elevationGainM: f.elevationGainM,
    avgHr: f.avgHr,
    maxHr: f.maxHr,
    avgPowerW: f.avgPowerW,
  });
}

export interface StravaActivityFacts {
  stravaId: string;
  sport: z.infer<typeof sportSchema>;
  name: string;
  startTime: Date;
  durationSec: number;
  movingSec?: number | null;
  distanceM: number | null;
  elevationGainM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPowerW: number | null;
  calories?: number | null;
}

export type StravaImportResult = { status: "already_imported" | "matched_garmin" | "imported"; activityId: string };

/**
 * Stores a Strava activity whose facts were read through Strava's MCP server (by WRKOUT's
 * own Claude calls, or by the athlete's Claude app via the WRKOUT connector). Idempotent by
 * Strava id; a session the watch already delivered through Garmin only gets the Strava id.
 * Only recent sessions get an automatic analysis.
 */
export async function importStravaActivity(f: StravaActivityFacts): Promise<StravaImportResult> {
  const [known] = await db.select({ id: activities.id }).from(activities).where(eq(activities.stravaId, f.stravaId));
  if (known) return { status: "already_imported", activityId: known.id };

  const window = 2 * 60 * 1000;
  const [garminTwin] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        isNull(activities.stravaId),
        eq(activities.source, "garmin"),
        between(activities.startTime, new Date(f.startTime.getTime() - window), new Date(f.startTime.getTime() + window)),
      ),
    );
  if (garminTwin) {
    await db.update(activities).set({ stravaId: f.stravaId }).where(eq(activities.id, garminTwin.id));
    return { status: "matched_garmin", activityId: garminTwin.id };
  }

  const round = (n: number | null | undefined) => (n ? Math.round(n) : null);
  const values = {
    stravaId: f.stravaId,
    source: "strava" as const,
    startTime: f.startTime,
    localDate: toLocalDate(f.startTime),
    sport: f.sport,
    subSport: null,
    name: f.name,
    durationSec: Math.round(f.durationSec),
    movingSec: round(f.movingSec),
    distanceM: f.distanceM,
    elevationGainM: f.elevationGainM,
    avgHr: round(f.avgHr),
    maxHr: round(f.maxHr),
    avgPowerW: round(f.avgPowerW),
    calories: round(f.calories),
  };
  const load = loadFor({ ...values, laps: [], extra: {}, normalizedPowerW: null, rpe: null }, await getProfile());
  const recent = values.localDate >= addDays(todayLocal(), -ANALYZE_WITHIN_DAYS);
  const [row] = await db
    .insert(activities)
    .values({ ...values, load: load.value, loadMethod: load.method, analysisStatus: recent ? "pending" : "skipped" })
    .returning();
  await linkToPlan(row);
  if (recent) await enqueue("analyze_activity", { activityId: row.id });
  return { status: "imported", activityId: row.id };
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

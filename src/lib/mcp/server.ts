import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, analyses } from "@/db/schema";
import { buildContext, fitnessToday } from "../ai/context";
import { addDays, todayLocal } from "../dates";
import { ANALYZE_WITHIN_DAYS, importStravaActivity } from "../ingest";
import { applyOrPropose, getActivePlan, workoutsBetween } from "../plan-store";
import { changeSetSchema } from "../training/changes";
import { sportSchema } from "../training/workout-structure";

// WRKOUT as a remote MCP server, added as a custom connector in the Claude app next to
// Strava's official connector. Claude reads Strava through Strava's connector and can hand
// sessions to import_strava_activities, so WRKOUT never calls Strava itself. The read tools
// serve only WRKOUT's own data: plans, analyses and Garmin-sourced activities. Rows with
// source "strava" stay out, so WRKOUT doesn't re-serve Strava data (Strava API Policy §5.16).

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const readOnly = { readOnlyHint: true, openWorldHint: false };
const notStrava = ne(activities.source, "strava");

async function latestAnalyses(activityIds: string[]) {
  if (!activityIds.length) return new Map<string, typeof analyses.$inferSelect>();
  const rows = await db
    .select()
    .from(analyses)
    .where(inArray(analyses.activityId, activityIds))
    .orderBy(desc(analyses.createdAt));
  const byActivity = new Map<string, typeof analyses.$inferSelect>();
  for (const r of rows) if (r.activityId && !byActivity.has(r.activityId)) byActivity.set(r.activityId, r);
  return byActivity;
}

const activityView = (a: typeof activities.$inferSelect) => ({
  id: a.id,
  date: a.localDate,
  startTime: a.startTime,
  sport: a.sport,
  subSport: a.subSport,
  name: a.name,
  durationSec: a.durationSec,
  distanceM: a.distanceM,
  elevationGainM: a.elevationGainM,
  avgHr: a.avgHr,
  maxHr: a.maxHr,
  avgPowerW: a.avgPowerW,
  normalizedPowerW: a.normalizedPowerW,
  load: a.load,
  plannedWorkoutId: a.plannedWorkoutId,
  compliance: a.compliance,
  rpe: a.rpe,
  feel: a.feel,
  notes: a.notes,
});

const analysisView =(a: typeof analyses.$inferSelect | undefined) =>
  a && { title: a.title, summary: a.summary, score: a.score, highlights: a.highlights, concerns: a.concerns };

export function createWrkoutMcpServer() {
  const server = new McpServer(
    { name: "wrkout", version: "1.0.0" },
    {
      instructions:
        "WRKOUT is the athlete's training app: profile, zones, goal, training plan, workout analyses and " +
        "activities recorded on their Garmin watch. Start with get_training_context. If a Strava connector is " +
        "also available, use it for sessions WRKOUT doesn't have, and when the athlete asks, pass them to " +
        "import_strava_activities (importing is idempotent, so re-sending a session is harmless). Plan changes " +
        "are only ever proposals: the athlete approves them in the WRKOUT app.",
    },
  );

  server.registerTool(
    "get_training_context",
    {
      title: "Training context",
      description:
        "Snapshot of the athlete right now: profile, markers and zones, goal, plan weeks, planned workouts " +
        "(with ids) for the past 14 days and coming days, activities from the last 28 days, fitness and " +
        "readiness, recent coach conversation and pending proposals.",
      inputSchema: { upcomingDays: z.number().int().min(1).max(60).optional().describe("Days of upcoming workouts, default 14") },
      annotations: readOnly,
    },
    async ({ upcomingDays }) => text(await buildContext({ upcomingDays: upcomingDays ?? 14, excludeStrava: true })),
  );

  server.registerTool(
    "get_planned_workouts",
    {
      title: "Planned workouts",
      description: "Planned workouts between two dates, with full step structure, purpose and status.",
      inputSchema: { from: dateSchema, to: dateSchema },
      annotations: readOnly,
    },
    async ({ from, to }) => {
      const active = await getActivePlan();
      if (!active) return text("There is no active plan.");
      const rows = await workoutsBetween(active.plan.id, from, to);
      return json(
        rows.map((w) => ({
          id: w.id,
          date: w.date,
          sport: w.sport,
          type: w.type,
          title: w.title,
          key: w.key,
          purpose: w.purpose,
          description: w.description,
          plannedDurationSec: w.plannedDurationSec,
          plannedDistanceM: w.plannedDistanceM,
          plannedLoad: w.plannedLoad,
          structure: w.structure,
          status: w.status,
          activityId: w.activityId,
        })),
      );
    },
  );

  server.registerTool(
    "get_activities",
    {
      title: "Activities",
      description:
        "Completed activities WRKOUT has (from the Garmin watch, or logged in the app) between two dates, " +
        "with load, plan match and WRKOUT's analysis. Use get_activity for laps.",
      inputSchema: { from: dateSchema, to: dateSchema },
      annotations: readOnly,
    },
    async ({ from, to }) => {
      const rows = await db
        .select()
        .from(activities)
        .where(and(gte(activities.localDate, from), lte(activities.localDate, to), notStrava))
        .orderBy(asc(activities.startTime));
      const byActivity = await latestAnalyses(rows.map((a) => a.id));
      return json(rows.map((a) => ({ ...activityView(a), analysis: analysisView(byActivity.get(a.id)) })));
    },
  );

  server.registerTool(
    "get_activity",
    {
      title: "Activity details",
      description: "One activity with laps, heart-rate zone times and WRKOUT's analysis.",
      inputSchema: { id: z.string().uuid() },
      annotations: readOnly,
    },
    async ({ id }) => {
      const [a] = await db
        .select()
        .from(activities)
        .where(and(eq(activities.id, id), notStrava));
      if (!a) return text("No such activity.");
      const byActivity = await latestAnalyses([a.id]);
      return json({
        ...activityView(a),
        movingSec: a.movingSec,
        avgCadence: a.avgCadence,
        calories: a.calories,
        loadMethod: a.loadMethod,
        laps: a.laps,
        hrZoneSeconds: a.hrZoneSeconds,
        extra: a.extra,
        analysis: analysisView(byActivity.get(a.id)),
      });
    },
  );

  server.registerTool(
    "get_fitness",
    {
      title: "Fitness trend",
      description: "Daily fitness (CTL), fatigue (ATL) and form (TSB), plus today's acute:chronic ratio.",
      inputSchema: { days: z.number().int().min(7).max(120).optional().describe("How many days back, default 42") },
      annotations: readOnly,
    },
    async ({ days }) => {
      const f = await fitnessToday();
      const since = addDays(todayLocal(), -(days ?? 42));
      return json({ today: { ctl: f.ctl, atl: f.atl, tsb: f.tsb, acwr: f.acwr }, series: f.series.filter((p) => p.date >= since) });
    },
  );

  server.registerTool(
    "import_strava_activities",
    {
      title: "Import Strava activities",
      description:
        "Store activities read from the Strava connector in WRKOUT, so they count towards training load and " +
        "plan matching. Map Strava's fields as described on each parameter. A session WRKOUT already has from " +
        "the Garmin watch is only linked, not duplicated, and sessions already imported are skipped. Sessions " +
        `from the last ${ANALYZE_WITHIN_DAYS} days also get WRKOUT's automatic analysis.`,
      inputSchema: {
        activities: z
          .array(
            z.object({
              stravaId: z.string().regex(/^\d+$/).describe("Strava activity id"),
              sport: sportSchema.describe("From sport_type: Run/TrailRun/VirtualRun → run, Ride/VirtualRide/GravelRide/MountainBikeRide → bike, Swim → swim, WeightTraining/Crossfit → strength, anything else → other"),
              name: z.string().max(200),
              startTime: z.string().datetime({ offset: true }).describe("start_date, ISO 8601 (UTC)"),
              durationSec: z.number().positive().describe("elapsed_time in seconds"),
              movingSec: z.number().positive().nullable().optional().describe("moving_time in seconds"),
              distanceM: z.number().nonnegative().nullable().describe("distance in metres"),
              elevationGainM: z.number().nonnegative().nullable().describe("total_elevation_gain in metres"),
              avgHr: z.number().positive().nullable().describe("average_heartrate"),
              maxHr: z.number().positive().nullable().describe("max_heartrate"),
              avgPowerW: z.number().positive().nullable().describe("average_watts"),
              calories: z.number().nonnegative().nullable().optional(),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ activities: items }) => {
      const results = [];
      for (const a of items) {
        try {
          const { status } = await importStravaActivity({ ...a, startTime: new Date(a.startTime) });
          results.push({ stravaId: a.stravaId, status });
        } catch (e) {
          results.push({ stravaId: a.stravaId, status: "failed", error: e instanceof Error ? e.message : String(e) });
        }
      }
      return json(results);
    },
  );

  server.registerTool(
    "propose_plan_change",
    {
      title: "Propose a plan change",
      description:
        "Propose edits to upcoming planned workouts (modify, move, add, remove; use ids from " +
        "get_training_context or get_planned_workouts). Nothing changes until the athlete approves the " +
        "proposal in the WRKOUT app.",
      inputSchema: changeSetSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (changeSet) => {
      const active = await getActivePlan();
      if (!active) return text("There is no active plan to change.");
      const change = await applyOrPropose(active.plan.id, "coach_note", changeSet, { alwaysPropose: true });
      if (!change) return text("No changes given.");
      return json({
        id: change.id,
        status: change.status,
        scope: change.scope,
        checks: change.reasons,
        next: "The athlete can approve or reject this in the WRKOUT app.",
      });
    },
  );

  return server;
}

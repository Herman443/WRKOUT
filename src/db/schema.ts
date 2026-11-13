import { boolean, date, index, integer, jsonb, pgSchema, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ChangeOp } from "@/lib/training/changes";
import type { Lap } from "@/lib/training/compliance";
import type { MacroPlan } from "@/lib/training/plan";
import type { Segment } from "@/lib/training/treadmill-live";
import type { RaceResult } from "@/lib/training/vdot";
import type { Sport, Step } from "@/lib/training/workout-structure";

// Everything lives in its own schema so Supabase's auto-generated Data API (which only
// exposes `public`) never serves these tables.
export const app = pgSchema("wrkout");

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export interface Availability {
  /** Weekdays available for training, 0 = Monday … 6 = Sunday */
  days: number[];
  longDay: number;
  weeklyHours: number;
  weeklyRunKm: number | null;
  weeklyBikeHours: number | null;
  /** Longest session that fits on a weekday, minutes */
  maxWeekdayMinutes: number | null;
  strength: boolean;
}

export interface PersonalRecord extends RaceResult {
  label: string;
  sport: "run" | "bike";
}

export const athleteProfile = app.table("athlete_profile", {
  id: integer("id").primaryKey().default(1),
  name: text("name"),
  sex: text("sex"),
  birthYear: integer("birth_year"),
  weightKg: real("weight_kg"),
  experience: text("experience").default("intermediate").notNull(),
  maxHr: integer("max_hr"),
  restingHr: integer("resting_hr"),
  lthrRun: integer("lthr_run"),
  lthrBike: integer("lthr_bike"),
  ftp: integer("ftp"),
  zone2PaceSecPerKm: integer("zone2_pace_sec_per_km"),
  /** Overrides the VDOT-derived threshold pace when set */
  thresholdPaceSecPerKm: integer("threshold_pace_sec_per_km"),
  vdot: real("vdot"),
  prs: jsonb("prs").$type<PersonalRecord[]>().default([]).notNull(),
  availability: jsonb("availability").$type<Availability>(),
  notes: text("notes"),
  updatedAt: updatedAt(),
});

export const goals = app.table("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  sport: text("sport").$type<"run" | "bike" | "swim" | "triathlon">().notNull(),
  name: text("name").notNull(),
  eventDate: date("event_date").notNull(),
  distanceM: integer("distance_m"),
  targetTimeSec: integer("target_time_sec"),
  status: text("status").$type<"active" | "archived" | "completed">().default("active").notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const plans = app.table("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .references(() => goals.id)
    .notNull(),
  status: text("status").$type<"generating" | "active" | "archived" | "failed">().default("generating").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  summary: text("summary"),
  macro: jsonb("macro").$type<Pick<MacroPlan, "phases" | "summary">>(),
  predictedFinishSec: integer("predicted_finish_sec"),
  warnings: jsonb("warnings").$type<string[]>().default([]).notNull(),
  error: text("error"),
  createdAt: createdAt(),
});

export const planWeeks = app.table(
  "plan_weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .references(() => plans.id, { onDelete: "cascade" })
      .notNull(),
    index: integer("index").notNull(),
    startDate: date("start_date").notNull(),
    phase: text("phase").notNull(),
    isDeload: boolean("is_deload").default(false).notNull(),
    targetHours: real("target_hours").notNull(),
    targetRunKm: real("target_run_km"),
    targetBikeHours: real("target_bike_hours"),
    focus: text("focus").notNull(),
    keySessions: jsonb("key_sessions").$type<string[]>().default([]).notNull(),
    detailStatus: text("detail_status").$type<"outline" | "detailed">().default("outline").notNull(),
  },
  (t) => [index("plan_weeks_plan_idx").on(t.planId, t.index)],
);

export const plannedWorkouts = app.table(
  "planned_workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .references(() => plans.id, { onDelete: "cascade" })
      .notNull(),
    weekId: uuid("week_id").references(() => planWeeks.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    sport: text("sport").$type<Sport>().notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    purpose: text("purpose").default("").notNull(),
    description: text("description").default("").notNull(),
    key: boolean("key").default(false).notNull(),
    plannedDurationSec: integer("planned_duration_sec"),
    plannedDistanceM: integer("planned_distance_m"),
    plannedLoad: real("planned_load"),
    structure: jsonb("structure").$type<Step[]>().default([]).notNull(),
    status: text("status").$type<"planned" | "completed" | "skipped" | "missed">().default("planned").notNull(),
    activityId: uuid("activity_id"),
    source: text("source").$type<"ai" | "user">().default("ai").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("planned_workouts_date_idx").on(t.date)],
);

export type AnalysisStatus = "pending" | "waiting_garmin" | "running" | "done" | "failed" | "skipped";

export const activities = app.table(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    garminId: text("garmin_id").unique(),
    stravaId: text("strava_id").unique(),
    source: text("source").$type<"garmin" | "strava" | "manual">().notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    localDate: date("local_date").notNull(),
    sport: text("sport").$type<Sport>().notNull(),
    subSport: text("sub_sport"),
    name: text("name").notNull(),
    durationSec: integer("duration_sec").notNull(),
    movingSec: integer("moving_sec"),
    distanceM: real("distance_m"),
    elevationGainM: real("elevation_gain_m"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    avgPowerW: integer("avg_power_w"),
    normalizedPowerW: integer("normalized_power_w"),
    avgCadence: real("avg_cadence"),
    calories: integer("calories"),
    load: real("load"),
    loadMethod: text("load_method"),
    laps: jsonb("laps").$type<Lap[]>().default([]).notNull(),
    hrZoneSeconds: jsonb("hr_zone_seconds").$type<number[]>(),
    /** Source-specific extras (training effect, VO2max estimate, weather…) */
    extra: jsonb("extra").$type<Record<string, unknown>>().default({}).notNull(),
    plannedWorkoutId: uuid("planned_workout_id"),
    compliance: jsonb("compliance").$type<{ score: number; volume: number; intensity: number | null; notes: string[] }>(),
    rpe: integer("rpe"),
    feel: text("feel"),
    notes: text("notes"),
    analysisStatus: text("analysis_status").$type<AnalysisStatus>().default("pending").notNull(),
    analysisAttempts: integer("analysis_attempts").default(0).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("activities_start_idx").on(t.startTime), index("activities_status_idx").on(t.analysisStatus)],
);

/** A treadmill run tracked live in the app; merged into the watch's activity when it syncs. */
export const treadmillSessions = app.table(
  "treadmill_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    plannedWorkoutId: uuid("planned_workout_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    segments: jsonb("segments").$type<Segment[]>().notNull(),
    /** False when the app's session is the only record (no watch activity is coming) */
    recordedOnWatch: boolean("recorded_on_watch").default(true).notNull(),
    activityId: uuid("activity_id"),
    createdAt: createdAt(),
  },
  (t) => [index("treadmill_sessions_started_idx").on(t.startedAt)],
);

export const analyses = app.table("analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<"activity" | "weekly" | "coach_note">().notNull(),
  activityId: uuid("activity_id").references(() => activities.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  score: integer("score"),
  highlights: jsonb("highlights").$type<string[]>().default([]).notNull(),
  concerns: jsonb("concerns").$type<string[]>().default([]).notNull(),
  changeId: uuid("change_id"),
  createdAt: createdAt(),
});

export const dailyHealth = app.table("daily_health", {
  date: date("date").primaryKey(),
  sleepScore: integer("sleep_score"),
  sleepSec: integer("sleep_sec"),
  hrvMs: real("hrv_ms"),
  hrvStatus: text("hrv_status"),
  restingHr: integer("resting_hr"),
  bodyBattery: integer("body_battery"),
  stress: integer("stress"),
  raw: jsonb("raw").$type<Record<string, unknown>>().default({}).notNull(),
  updatedAt: updatedAt(),
});

export const planChanges = app.table("plan_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .references(() => plans.id, { onDelete: "cascade" })
    .notNull(),
  trigger: text("trigger").$type<"activity" | "weekly_review" | "coach_note" | "missed">().notNull(),
  scope: text("scope").$type<"minor" | "major">().notNull(),
  status: text("status").$type<"applied" | "pending" | "rejected" | "failed">().notNull(),
  rationale: text("rationale").notNull(),
  reasons: jsonb("reasons").$type<string[]>().default([]).notNull(),
  ops: jsonb("ops").$type<ChangeOp[]>().notNull(),
  error: text("error"),
  createdAt: createdAt(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const coachMessages = app.table("coach_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: text("role").$type<"user" | "coach">().notNull(),
  content: text("content").notNull(),
  changeId: uuid("change_id"),
  createdAt: createdAt(),
});

export const pushSubscriptions = app.table("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: createdAt(),
});

/** Integration state (token caches, OAuth clients). Secrets inside are encrypted. */
export const integrations = app.table("integrations", {
  key: text("key").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
  updatedAt: updatedAt(),
});

export const kv = app.table("kv", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: updatedAt(),
});

export type JobKind =
  | "macro_plan"
  | "detail_weeks"
  | "analyze_activity"
  | "weekly_review"
  | "coach_note"
  | "strava_activity";

/** Work that may take longer than one request, run one step per function invocation. */
export const jobs = app.table(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<JobKind>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.runAfter)],
);

export const aiCalls = app.table("ai_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  cacheReadTokens: integer("cache_read_tokens").default(0).notNull(),
  costUsd: real("cost_usd").default(0).notNull(),
  createdAt: createdAt(),
});

export type AthleteProfile = typeof athleteProfile.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type PlanWeek = typeof planWeeks.$inferSelect;
export type PlannedWorkout = typeof plannedWorkouts.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
export type DailyHealth = typeof dailyHealth.$inferSelect;
export type PlanChange = typeof planChanges.$inferSelect;
export type TreadmillSession = typeof treadmillSessions.$inferSelect;

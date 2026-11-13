CREATE SCHEMA "wrkout";
--> statement-breakpoint
CREATE TABLE "wrkout"."activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"garmin_id" text,
	"strava_id" text,
	"source" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"sport" text NOT NULL,
	"sub_sport" text,
	"name" text NOT NULL,
	"duration_sec" integer NOT NULL,
	"moving_sec" integer,
	"distance_m" real,
	"elevation_gain_m" real,
	"avg_hr" integer,
	"max_hr" integer,
	"avg_power_w" integer,
	"normalized_power_w" integer,
	"avg_cadence" real,
	"calories" integer,
	"load" real,
	"load_method" text,
	"laps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hr_zone_seconds" jsonb,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"planned_workout_id" uuid,
	"compliance" jsonb,
	"rpe" integer,
	"feel" text,
	"notes" text,
	"analysis_status" text DEFAULT 'pending' NOT NULL,
	"analysis_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_garmin_id_unique" UNIQUE("garmin_id"),
	CONSTRAINT "activities_strava_id_unique" UNIQUE("strava_id")
);
--> statement-breakpoint
CREATE TABLE "wrkout"."ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"activity_id" uuid,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"score" integer,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"concerns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."athlete_profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text,
	"sex" text,
	"birth_year" integer,
	"weight_kg" real,
	"experience" text DEFAULT 'intermediate' NOT NULL,
	"max_hr" integer,
	"resting_hr" integer,
	"lthr_run" integer,
	"lthr_bike" integer,
	"ftp" integer,
	"zone2_pace_sec_per_km" integer,
	"threshold_pace_sec_per_km" integer,
	"vdot" real,
	"prs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"availability" jsonb,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."coach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"change_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."daily_health" (
	"date" date PRIMARY KEY NOT NULL,
	"sleep_score" integer,
	"sleep_sec" integer,
	"hrv_ms" real,
	"hrv_status" text,
	"resting_hr" integer,
	"body_battery" integer,
	"stress" integer,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport" text NOT NULL,
	"name" text NOT NULL,
	"event_date" date NOT NULL,
	"distance_m" integer,
	"target_time_sec" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."integrations" (
	"key" text PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."plan_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"scope" text NOT NULL,
	"status" text NOT NULL,
	"rationale" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ops" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wrkout"."plan_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"start_date" date NOT NULL,
	"phase" text NOT NULL,
	"is_deload" boolean DEFAULT false NOT NULL,
	"target_hours" real NOT NULL,
	"target_run_km" real,
	"target_bike_hours" real,
	"focus" text NOT NULL,
	"key_sessions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detail_status" text DEFAULT 'outline' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."planned_workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"week_id" uuid,
	"date" date NOT NULL,
	"sport" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"key" boolean DEFAULT false NOT NULL,
	"planned_duration_sec" integer,
	"planned_distance_m" integer,
	"planned_load" real,
	"structure" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"activity_id" uuid,
	"source" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"summary" text,
	"macro" jsonb,
	"predicted_finish_sec" integer,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wrkout"."push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wrkout"."analyses" ADD CONSTRAINT "analyses_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "wrkout"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrkout"."plan_changes" ADD CONSTRAINT "plan_changes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "wrkout"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrkout"."plan_weeks" ADD CONSTRAINT "plan_weeks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "wrkout"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrkout"."planned_workouts" ADD CONSTRAINT "planned_workouts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "wrkout"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrkout"."planned_workouts" ADD CONSTRAINT "planned_workouts_week_id_plan_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "wrkout"."plan_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrkout"."plans" ADD CONSTRAINT "plans_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "wrkout"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_start_idx" ON "wrkout"."activities" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "activities_status_idx" ON "wrkout"."activities" USING btree ("analysis_status");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "wrkout"."jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "plan_weeks_plan_idx" ON "wrkout"."plan_weeks" USING btree ("plan_id","index");--> statement-breakpoint
CREATE INDEX "planned_workouts_date_idx" ON "wrkout"."planned_workouts" USING btree ("date");
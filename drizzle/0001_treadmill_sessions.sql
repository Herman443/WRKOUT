CREATE TABLE "wrkout"."treadmill_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planned_workout_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"segments" jsonb NOT NULL,
	"recorded_on_watch" boolean DEFAULT true NOT NULL,
	"activity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "treadmill_sessions_started_idx" ON "wrkout"."treadmill_sessions" USING btree ("started_at");
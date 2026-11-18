CREATE INDEX "activities_local_date_idx" ON "wrkout"."activities" USING btree ("local_date","sport","start_time");--> statement-breakpoint
CREATE INDEX "ai_calls_created_idx" ON "wrkout"."ai_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analyses_created_idx" ON "wrkout"."analyses" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analyses_activity_created_idx" ON "wrkout"."analyses" USING btree ("activity_id","created_at");--> statement-breakpoint
CREATE INDEX "analyses_kind_created_idx" ON "wrkout"."analyses" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "coach_messages_created_idx" ON "wrkout"."coach_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "plan_changes_status_created_idx" ON "wrkout"."plan_changes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "planned_workouts_plan_date_idx" ON "wrkout"."planned_workouts" USING btree ("plan_id","date","created_at");
import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs, plans, type JobKind } from "@/db/schema";
import { env } from "./env";

// A tiny durable queue. Vercel functions stop after maxDuration (300 s), and plan
// generation can take minutes, so each job runs in its own invocation of
// /api/jobs/run, which re-triggers itself while work remains.

export async function enqueue(kind: JobKind, payload: Record<string, unknown> = {}, delayMs = 0) {
  const [job] = await db
    .insert(jobs)
    .values({ kind, payload, runAfter: new Date(Date.now() + delayMs) })
    .returning();
  return job;
}

export async function hasOpenJob(kind: JobKind, match?: (payload: Record<string, unknown>) => boolean) {
  const open = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.kind, kind), inArray(jobs.status, ["queued", "running"])));
  return open.some((j) => !match || match(j.payload));
}

/** Fire-and-forget request that starts a worker invocation. */
export async function kickWorker() {
  try {
    await fetch(`${env.appUrl}/api/jobs/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.cronSecret}` },
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    // Timeouts are expected: the worker answers only after it has claimed a job.
  }
}

/** Claims the oldest runnable job (SKIP LOCKED so parallel workers never share one). */
async function claim() {
  // Jobs left "running" by a crashed or timed-out invocation are retried.
  await db
    .update(jobs)
    .set({ status: "queued" })
    .where(and(eq(jobs.status, "running"), lt(jobs.updatedAt, new Date(Date.now() - 6 * 60 * 1000))));

  const rows = await db.execute<{ id: string }>(sql`
    update wrkout.jobs set status = 'running', attempts = attempts + 1, updated_at = now()
    where id = (
      select id from wrkout.jobs
      where status = 'queued' and run_after <= now()
      order by created_at
      for update skip locked
      limit 1
    )
    returning id`);
  const id = rows[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

type Handler = (payload: Record<string, unknown>) => Promise<void>;

/** Runs one job. Returns true when more work may be waiting. */
export async function runOneJob(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  const handlers = await loadHandlers();
  try {
    await handlers[job.kind](job.payload);
    await db.update(jobs).set({ status: "done", error: null }).where(eq(jobs.id, job.id));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`job ${job.kind} failed`, e);
    const retry = job.attempts < 3;
    await db
      .update(jobs)
      .set({
        status: retry ? "queued" : "failed",
        error: message,
        runAfter: new Date(Date.now() + 2 ** job.attempts * 60 * 1000),
      })
      .where(eq(jobs.id, job.id));
    if (!retry) await onFinalFailure(job.kind, job.payload, message);
  }
  return true;
}

async function onFinalFailure(kind: JobKind, payload: Record<string, unknown>, message: string) {
  if (kind === "macro_plan" && typeof payload.planId === "string") {
    await db.update(plans).set({ status: "failed", error: message }).where(eq(plans.id, payload.planId));
  }
  if (kind === "analyze_activity" && typeof payload.activityId === "string") {
    const { activities } = await import("@/db/schema");
    await db.update(activities).set({ analysisStatus: "failed" }).where(eq(activities.id, payload.activityId));
  }
}

// Handlers are imported lazily so this module stays light for callers that only enqueue.
async function loadHandlers(): Promise<Record<JobKind, Handler>> {
  const [{ generateMacroPlan, detailWeeks }, { analyzeActivity }, { weeklyReview }, { handleCoachNote }, { ingestStravaActivity }] =
    await Promise.all([import("./ai/plan"), import("./ai/analyze"), import("./ai/review"), import("./ai/coach"), import("./ingest")]);
  return {
    macro_plan: async (p) => {
      const planId = String(p.planId);
      const weeks = await generateMacroPlan(planId);
      if (weeks.length) await enqueue("detail_weeks", { planId, weekIndexes: weeks });
    },
    detail_weeks: async (p) => detailWeeks(String(p.planId), (p.weekIndexes as number[]) ?? []),
    analyze_activity: async (p) => analyzeActivity(String(p.activityId)),
    weekly_review: async (p) => {
      const weeks = await weeklyReview();
      if (weeks.length && typeof p.planId === "string") await enqueue("detail_weeks", { planId: p.planId, weekIndexes: weeks });
    },
    coach_note: async (p) => handleCoachNote(String(p.text), p.trigger === "missed" ? "missed" : "coach_note"),
    strava_activity: async (p) => ingestStravaActivity(String(p.stravaId), Number(p.eventTime)),
  };
}

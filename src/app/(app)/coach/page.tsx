import { desc, eq, inArray } from "drizzle-orm";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { SubmitButton } from "@/components/submit-button";
import { PageTitle, Panel, Section, Skeleton, TextLink, inputClass } from "@/components/ui";
import { db } from "@/db";
import { analyses, coachMessages, jobs, planChanges, plannedWorkouts, type PlanChange, type PlannedWorkout } from "@/db/schema";
import type { MarkerUpdate } from "@/lib/ai/review";
import { requireSession } from "@/lib/auth";
import { formatDay } from "@/lib/dates";
import { getKv } from "@/lib/ingest";
import type { ChangeOp } from "@/lib/training/changes";
import { compactDuration, formatPace } from "@/lib/training/vdot";
import { applyMarkerUpdates, decideProposal, sendCoachNote } from "../actions";

export default function CoachPage() {
  return (
    <Suspense fallback={<Skeleton lines={5} />}>
      <Coach />
    </Suspense>
  );
}

const MARKER_LABEL: Record<string, (v: number) => string> = {
  vdot: (v) => `VDOT ${v.toFixed(1)}`,
  ftp: (v) => `FTP ${Math.round(v)} W`,
  lthrRun: (v) => `Run threshold HR ${Math.round(v)}`,
  lthrBike: (v) => `Bike threshold HR ${Math.round(v)}`,
  maxHr: (v) => `Max HR ${Math.round(v)}`,
  restingHr: (v) => `Resting HR ${Math.round(v)}`,
  zone2PaceSecPerKm: (v) => `Zone 2 pace ${formatPace(v)}/km`,
  thresholdPaceSecPerKm: (v) => `Threshold pace ${formatPace(v)}/km`,
};

async function Coach() {
  await requireSession();
  const [pending, messages, [weekly], markerUpdates, thinking] = await Promise.all([
    db.select().from(planChanges).where(eq(planChanges.status, "pending")).orderBy(desc(planChanges.createdAt)),
    db.select().from(coachMessages).orderBy(desc(coachMessages.createdAt)).limit(30),
    db.select().from(analyses).where(eq(analyses.kind, "weekly")).orderBy(desc(analyses.createdAt)).limit(1),
    getKv<MarkerUpdate[]>("pending_marker_updates"),
    db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.status, ["queued", "running"])).then((rows) => rows.length > 0),
  ]);
  const ids = pending.flatMap((c) => c.ops.flatMap((op) => ("workoutId" in op ? [op.workoutId] : [])));
  const workouts = ids.length ? await db.select().from(plannedWorkouts).where(inArray(plannedWorkouts.id, ids)) : [];
  const byId = new Map(workouts.map((w) => [w.id, w]));
  const thread = [...messages].reverse();
  const recentChanges = await db.select().from(planChanges).where(eq(planChanges.status, "applied")).orderBy(desc(planChanges.createdAt)).limit(5);

  return (
    <>
      <PageTitle sub="Ask, report, or adjust">Coach</PageTitle>

      {pending.map((c) => (
        <Proposal key={c.id} change={c} byId={byId} />
      ))}

      {markerUpdates && markerUpdates.length > 0 && (
        <Panel className="mt-6 border border-ink">
          <h2 className="font-medium">Your fitness has moved</h2>
          <form action={applyMarkerUpdates} className="mt-2 space-y-2">
            {markerUpdates.map((u) => (
              <label key={u.marker} className="flex gap-3 text-[15px]">
                <input type="checkbox" name="marker" value={u.marker} defaultChecked className="mt-1 h-4 w-4 accent-[var(--ink)]" />
                <span>
                  <span className="font-medium">{MARKER_LABEL[u.marker]?.(u.value) ?? `${u.marker} ${u.value}`}</span>
                  <span className="block text-sm text-muted">{u.reason}</span>
                </span>
              </label>
            ))}
            <SubmitButton pendingText="Updating…" className="mt-2">
              Update my paces and zones
            </SubmitButton>
          </form>
        </Panel>
      )}

      {weekly && (
        <Section title="Weekly review">
          <Panel>
            <p className="text-sm text-muted">{formatDay(weekly.createdAt.toISOString().slice(0, 10))}</p>
            <h3 className="mt-0.5 font-medium">{weekly.title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed">{weekly.summary}</p>
          </Panel>
        </Section>
      )}

      <Section title="Conversation">
        {thread.length === 0 && (
          <p className="text-muted">Tell your coach about soreness, travel, a bad night or a great day. Plan changes follow from what you say.</p>
        )}
        <ol className="space-y-3">
          {thread.map((m) => (
            <li key={m.id} className={m.role === "user" ? "ml-10" : "mr-6"}>
              <div
                className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${m.role === "user" ? "bg-ink text-fog" : "bg-paper"}`}
              >
                {m.content}
              </div>
            </li>
          ))}
        </ol>
        {thinking && (
          <p className="mt-3 text-sm text-muted">
            Your coach is working on it…
            <AutoRefresh seconds={6} />
          </p>
        )}
        <form action={sendCoachNote} className="mt-5 space-y-2">
          <textarea
            name="text"
            rows={3}
            required
            placeholder="My left calf is tight after yesterday's run"
            className={inputClass}
            aria-label="Message to your coach"
          />
          <SubmitButton pendingText="Sending…">Send to coach</SubmitButton>
        </form>
      </Section>

      {recentChanges.length > 0 && (
        <Section title="Recent plan changes">
          <ul className="space-y-2 text-[15px]">
            {recentChanges.map((c) => (
              <li key={c.id}>
                <span className="text-sm text-muted">{formatDay(c.createdAt.toISOString().slice(0, 10))}. </span>
                {c.rationale}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="mt-10">
        <TextLink href="/activities">All activities</TextLink>
      </div>
    </>
  );
}

function describeOp(op: ChangeOp, byId: Map<string, PlannedWorkout>): string {
  const w = "workoutId" in op ? byId.get(op.workoutId) : undefined;
  const label = (title: string, date: string) => `${formatDay(date)}: ${title}`;
  switch (op.op) {
    case "remove":
      return w ? `Drop ${label(w.title, w.date)}` : "Drop a session";
    case "move":
      return w ? `Move ${w.title} from ${formatDay(w.date)} to ${formatDay(op.newDate)}` : `Move a session to ${formatDay(op.newDate)}`;
    case "add":
      return `Add ${label(op.workout.title, op.workout.date)}${op.workout.plannedDurationSec ? `, ${compactDuration(op.workout.plannedDurationSec)}` : ""}`;
    case "modify":
      return w && w.title !== op.workout.title
        ? `Change ${label(w.title, w.date)} to ${op.workout.title}`
        : `Adjust ${label(op.workout.title, op.workout.date)}${op.workout.plannedDurationSec ? `, now ${compactDuration(op.workout.plannedDurationSec)}` : ""}`;
  }
}

function Proposal({ change, byId }: { change: PlanChange; byId: Map<string, PlannedWorkout> }) {
  return (
    <Panel className="mt-6 border border-ink">
      <h2 className="font-medium">Suggested plan change</h2>
      <p className="mt-1 text-[15px] leading-relaxed">{change.rationale}</p>
      <ul className="mt-3 space-y-1.5 text-[15px]">
        {change.ops.map((op, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" aria-hidden />
            {describeOp(op, byId)}
          </li>
        ))}
      </ul>
      {change.reasons.length > 0 && (
        <p className="mt-3 text-sm text-muted">Needs your OK because: {change.reasons.join("; ").replace(/Check: /g, "")}.</p>
      )}
      <form action={decideProposal} className="mt-4 flex gap-2">
        <input type="hidden" name="id" value={change.id} />
        <SubmitButton name="decision" value="approve" pendingText="Applying…">
          Apply changes
        </SubmitButton>
        <SubmitButton name="decision" value="reject" variant="quiet">
          Keep my plan
        </SubmitButton>
      </form>
    </Panel>
  );
}


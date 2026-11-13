import { between, desc } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Silhouette } from "@/components/silhouette";
import { PageTitle, Section, Skeleton, Stat, TextLink } from "@/components/ui";
import { db } from "@/db";
import { activities } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { addDays, diffDays, formatDay, startOfWeek, todayLocal } from "@/lib/dates";
import { getActivePlan, getWeeks, workoutsBetween } from "@/lib/plan-store";
import { compactDuration, formatDuration } from "@/lib/training/vdot";

export default function PlanPage() {
  return (
    <Suspense fallback={<Skeleton lines={6} />}>
      <Plan />
    </Suspense>
  );
}

const PHASE_TONE: Record<string, string> = {
  base: "bg-ink/15",
  build: "bg-ink/35",
  peak: "bg-ink/60",
  taper: "bg-ink/25",
  race: "bg-ink",
  recovery: "bg-ink/10",
};

const PHASE_NAME: Record<string, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  race: "Race",
  recovery: "Recovery",
};

async function Plan() {
  await requireSession();
  const active = await getActivePlan();
  if (!active) {
    return (
      <>
        <PageTitle>No plan yet</PageTitle>
        <p className="mt-3 text-muted">Choose a goal and your coach builds the weeks up to it.</p>
        <Link href="/onboarding" className="mt-6 inline-block rounded-xl bg-ink px-5 py-3 font-medium text-fog">
          Choose a goal
        </Link>
      </>
    );
  }
  const { plan, goal } = active;
  const today = todayLocal();
  const weeks = await getWeeks(plan.id);
  const weeksToGo = Math.max(0, Math.ceil(diffDays(today, goal.eventDate) / 7));
  const dateLine = formatDay(goal.eventDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  if (weeks.length === 0) {
    return (
      <>
        <PageTitle sub={dateLine}>{goal.name}</PageTitle>
        <p className="mt-4 text-muted">
          {plan.status === "failed" ? `The plan could not be built: ${plan.error}` : "Your coach is building the plan. This page updates by itself."}
        </p>
        {plan.status === "generating" && <AutoRefresh seconds={8} />}
      </>
    );
  }

  const end = addDays(weeks.at(-1)!.startDate, 6);
  const [workouts, recordedActivities] = await Promise.all([
    workoutsBetween(plan.id, weeks[0].startDate, end),
    db
      .select({
        id: activities.id,
        localDate: activities.localDate,
        name: activities.name,
        sport: activities.sport,
        durationSec: activities.durationSec,
      })
      .from(activities)
      .where(between(activities.localDate, weeks[0].startDate, end))
      .orderBy(desc(activities.startTime)),
  ]);
  const scheduledActivityIds = new Set(workouts.map((workout) => workout.activityId));
  const schedule = [
    ...workouts.map((workout) => ({
      ...workout,
      href: `/workout/${workout.id}`,
      unplanned: false,
      muted: workout.status === "missed" || workout.status === "skipped",
    })),
    ...recordedActivities
      .filter((activity) => activity.sport === "run" && !scheduledActivityIds.has(activity.id))
      .map((activity) => ({
        id: activity.id,
        date: activity.localDate,
        title: activity.name,
        href: `/activities/${activity.id}`,
        unplanned: true,
        status: "completed",
        structure: [],
        type: "easy",
        plannedDurationSec: activity.durationSec,
        muted: true,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const thisWeek = startOfWeek(today);
  const maxHours = Math.max(...weeks.map((w) => w.targetHours), 1);

  // Consecutive weeks of the same phase become one timeline segment.
  const segments: { phase: string; count: number }[] = [];
  for (const w of weeks) {
    const last = segments.at(-1);
    if (last && last.phase === w.phase) last.count++;
    else segments.push({ phase: w.phase, count: 1 });
  }
  const currentIndex = weeks.findIndex((w) => w.startDate === thisWeek);

  return (
    <>
      <PageTitle sub={dateLine}>{goal.name}</PageTitle>
      <div className="mt-6 flex gap-8">
        <Stat value={weeksToGo} label={weeksToGo === 1 ? "week to go" : "weeks to go"} />
        {goal.targetTimeSec && <Stat value={formatDuration(goal.targetTimeSec)} label="Target" />}
        {plan.predictedFinishSec && <Stat value={formatDuration(plan.predictedFinishSec)} label="Predicted" />}
      </div>

      <div className="mt-8">
        <div className="relative flex h-3 gap-0.5 overflow-hidden rounded-full">
          {segments.map((s, i) => (
            <div key={i} className={PHASE_TONE[s.phase] ?? "bg-ink/20"} style={{ flexGrow: s.count }} />
          ))}
        </div>
        {currentIndex >= 0 && (
          <div className="relative h-2">
            <div
              className="absolute top-0.5 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-ink"
              style={{ left: `${((currentIndex + 0.5) / weeks.length) * 100}%` }}
              aria-label="This week"
            />
          </div>
        )}
        <div className="mt-1 flex gap-0.5 text-xs text-muted">
          {segments.map((s, i) => (
            <div key={i} className="min-w-0 truncate" style={{ flexGrow: s.count, flexBasis: 0 }}>
              {s.count >= 2 ? PHASE_NAME[s.phase] : ""}
            </div>
          ))}
        </div>
      </div>

      {plan.summary && <p className="mt-6 max-w-prose text-[15px] leading-relaxed text-muted">{plan.summary}</p>}

      <Section title="Weeks">
        <ol className="space-y-2">
          {weeks.map((w) => {
            const weekEnd = addDays(w.startDate, 6);
            const isPast = weekEnd < today;
            const isCurrent = w.startDate === thisWeek;
            const items = schedule.filter((x) => x.date >= w.startDate && x.date <= weekEnd);
            const recorded = recordedActivities.filter((a) => a.localDate >= w.startDate && a.localDate <= weekEnd);
            const hoursDone = recorded
              .filter((a) => a.localDate <= today)
              .reduce((sum, a) => sum + a.durationSec, 0) / 3600;
            return (
              <li key={w.id}>
                <details open={isCurrent || (!isPast && w.startDate <= addDays(thisWeek, 7))} className="group rounded-2xl bg-paper">
                  <summary className="flex cursor-pointer list-none items-center gap-4 p-4">
                    <span className="num w-8 text-2xl">{w.index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {PHASE_NAME[w.phase] ?? w.phase}
                        {w.isDeload && <span className="font-normal text-muted">, lighter week</span>}
                        {isCurrent && <span className="font-normal text-muted">, this week</span>}
                      </span>
                      <span className="block text-sm text-muted">
                        {formatDay(w.startDate, { day: "numeric", month: "short" })}
                        {w.targetRunKm ? `, ${Math.round(w.targetRunKm)} km` : ""}
                      </span>
                      <span className="mt-2 block h-1.5 rounded-full bg-line" aria-hidden>
                        <span className="block h-full rounded-full bg-ink/25" style={{ width: `${(w.targetHours / maxHours) * 100}%` }}>
                          <span
                            className="block h-full rounded-full bg-ink"
                            style={{ width: `${Math.min(100, (hoursDone / w.targetHours) * 100)}%` }}
                          />
                        </span>
                      </span>
                    </span>
                    <span className="num text-right text-lg">
                      {w.targetHours.toFixed(1)}
                      <span className="ml-0.5 text-sm font-medium text-muted">h</span>
                    </span>
                  </summary>
                  <div className="border-t border-line px-4 pt-2 pb-4">
                    <p className="text-sm text-muted">{w.focus}</p>
                    {items.length > 0 ? (
                      <ul className="mt-2 divide-y divide-line">
                        {items.map((x) => (
                          <li key={x.id}>
                            <Link
                              href={x.href}
                              className={`relative isolate flex items-center gap-3 py-2.5 ${x.unplanned ? "before:pointer-events-none before:absolute before:inset-y-1 before:-inset-x-2 before:-z-10 before:rounded-lg before:bg-line/35" : ""}`}
                            >
                              <span className="w-12 shrink-0 text-sm text-muted">{formatDay(x.date, { weekday: "short" })}</span>
                              <span className={`min-w-0 flex-1 truncate ${x.status === "skipped" || x.status === "missed" ? "text-muted line-through" : ""}`}>
                                {x.title}
                              </span>
                              <Silhouette
                                structure={x.structure}
                                type={x.type}
                                plannedDurationSec={x.plannedDurationSec}
                                height={18}
                                gap={1}
                                className="w-16 shrink-0"
                                muted={x.muted}
                              />
                              <span className="num w-12 shrink-0 text-right">
                                {x.status === "completed" ? "✓" : x.plannedDurationSec ? compactDuration(x.plannedDurationSec) : ""}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-muted">
                        {w.keySessions.length ? `Key sessions: ${w.keySessions.join("; ")}. ` : ""}
                        Sessions are written about two weeks ahead, so they fit how training is going.
                      </p>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </Section>

      {plan.warnings.length > 0 && (
        <details className="mt-8 text-sm text-muted">
          <summary className="cursor-pointer">Notes from the plan checks ({plan.warnings.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-8">
        <TextLink href="/onboarding">Change goal</TextLink>
      </div>
    </>
  );
}

import { and, between, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { PaceProfile } from "@/components/pace-profile";
import { SubmitButton } from "@/components/submit-button";
import { Panel, PageTitle, Section, Skeleton, StartTreadmill, TextLink } from "@/components/ui";
import { WeekStrip } from "@/components/week-strip";
import { WorkoutHero } from "@/components/workout-hero";
import { db } from "@/db";
import { activities, analyses, dailyHealth, planChanges } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { addDays, dateRange, formatDay, localTime, startOfWeek, todayLocal } from "@/lib/dates";
import { getKv } from "@/lib/ingest";
import { getActivePlan, workoutsBetween } from "@/lib/plan-store";
import { paceTrusted, type RunSurface } from "@/lib/training/treadmill";
import { formatDuration } from "@/lib/training/vdot";
import { retryPlan } from "./actions";

export default function TodayPage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <Today searchParams={searchParams} />
    </Suspense>
  );
}

async function Today({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  await requireSession();
  const today = todayLocal();
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const { day } = await searchParams;
  const viewingDay = typeof day === "string" && dateRange(weekStart, weekEnd).includes(day);
  const selectedDate = viewingDay ? day : today;
  const [active, runs] = await Promise.all([
    getActivePlan(),
    db.select({
      id: activities.id,
      localDate: activities.localDate,
      name: activities.name,
      durationSec: activities.durationSec,
      distanceM: activities.distanceM,
      startTime: activities.startTime,
      laps: activities.laps,
      subSport: activities.subSport,
      extra: activities.extra,
    }).from(activities)
      .where(and(eq(activities.sport, "run"), between(activities.localDate, weekStart, today)))
      .orderBy(desc(activities.startTime)),
  ]);
  const dateLine = formatDay(selectedDate, { weekday: "long", day: "numeric", month: "long" });
  const dayRuns = runs.filter((run) => run.localDate === selectedDate);
  const hasCompletedRun = dayRuns.length > 0;
  const daySessions = (workouts: Parameters<typeof WeekStrip>[0]["workouts"], surface?: RunSurface) => {
    const dayWorkouts = workouts.filter((workout) =>
      workout.date === selectedDate && workout.status !== "skipped" &&
      !dayRuns.some((run) => run.id === workout.activityId)
    );
    const title = dayWorkouts.length ? "Sessions" : hasCompletedRun
      ? selectedDate === today ? "Completed today" : "Completed sessions"
      : "Rest day";
    return (
      <section className="mt-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="mt-2 space-y-2">
          {dayRuns.map((run) => {
            const { hour, minute } = localTime(run.startTime);
            return (
              <Link key={run.id} href={`/activities/${run.id}`} className="block rounded-2xl">
                <Panel>
                  <h2 className="text-xl font-semibold">{run.name}</h2>
                  <p className="text-sm text-muted">
                    {hour}:{String(minute).padStart(2, "0")} · {formatDuration(run.durationSec)}
                    {run.distanceM ? ` · ${(run.distanceM / 1000).toFixed(1)} km` : ""}
                  </p>
                  <PaceProfile laps={run.laps} estimated={!paceTrusted(run)} />
                </Panel>
              </Link>
            );
          })}
          {dayWorkouts.map((workout) => (
            <Link
              key={workout.id}
              href={workout.activityId ? `/activities/${workout.activityId}` : `/workout/${workout.id}`}
              className="block rounded-2xl"
            >
              <Panel>
                <h2 className="text-xl font-semibold">{workout.title}</h2>
                <WorkoutHero workout={workout} compact surface={surface} />
              </Panel>
            </Link>
          ))}
        </div>
      </section>
    );
  };
  const completedRunHero = hasCompletedRun ? daySessions([]) : null;
  const selectedDayWithoutPlan = viewingDay && (
    <>
      <p className="text-sm text-muted">{dateLine}</p>
      {daySessions([])}
    </>
  );
  const weekOverview = (workouts: Parameters<typeof WeekStrip>[0]["workouts"]) => (
    <Section title="This week" action={active && <TextLink href="/plan">Full plan</TextLink>}>
      <WeekStrip weekStart={weekStart} today={today} selectedDate={selectedDate} workouts={workouts} runs={runs} />
    </Section>
  );

  if (!active) {
    return (
      <>
        {selectedDayWithoutPlan || completedRunHero || <PageTitle sub={dateLine}>Set a goal to get your plan</PageTitle>}
        <p className="mt-3 max-w-prose text-muted">
          Pick a race or event, tell the coach about your week and your current speed, and it builds the training up to race day.
        </p>
        <Link href="/onboarding" className="mt-6 inline-block rounded-xl bg-ink px-5 py-3 font-medium text-fog">
          Choose a goal
        </Link>
        {weekOverview([])}
      </>
    );
  }

  const { plan, goal } = active;
  if (plan.status === "generating" || plan.status === "failed") {
    return (
      <>
        {selectedDayWithoutPlan || completedRunHero || (
          <PageTitle sub={dateLine}>{plan.status === "failed" ? "The plan could not be built" : "Building your plan"}</PageTitle>
        )}
        {plan.status === "generating" ? (
          <>
            <p className="mt-3 max-w-prose text-muted">
              Your coach is laying out the weeks to {goal.name}, then the first two weeks of sessions. This usually takes 3–6 minutes.
            </p>
            <div className="mt-8 flex h-20 items-end gap-1.5" aria-hidden>
              {[34, 50, 70, 50, 86, 34, 50, 100, 34].map((h, i) => (
                <div key={i} className="w-full animate-pulse rounded-[3px] bg-line" style={{ height: `${h}%`, animationDelay: `${i * 120}ms` }} />
              ))}
            </div>
            <AutoRefresh seconds={8} />
          </>
        ) : (
          <>
            <p className="mt-3 max-w-prose text-muted">{plan.error ?? "Something went wrong."}</p>
            <form action={retryPlan} className="mt-6">
              <SubmitButton pendingText="Retrying…">Try again</SubmitButton>
            </form>
          </>
        )}
        {weekOverview([])}
      </>
    );
  }

  const [week, [health], pending, [latest], surface] = await Promise.all([
    workoutsBetween(plan.id, weekStart, weekEnd),
    db.select().from(dailyHealth).where(eq(dailyHealth.date, today)),
    db.select({ id: planChanges.id }).from(planChanges).where(eq(planChanges.status, "pending")),
    db.select().from(analyses).orderBy(desc(analyses.createdAt)).limit(1),
    getKv<RunSurface>("run_surface").then((s) => s ?? "outdoor"),
  ]);
  const todays = week.filter((w) => w.date === today && w.status !== "skipped");
  const main = hasCompletedRun ? undefined : todays.find((w) => w.status === "planned" && w.sport === "run");
  const next = !viewingDay && !hasCompletedRun && !main
    ? (await workoutsBetween(plan.id, addDays(today, 1), goal.eventDate)).find((w) => w.status === "planned" && w.sport === "run")
    : null;
  const otherWorkouts = todays.filter((w) => w.id !== main?.id && (!hasCompletedRun || w.status !== "completed" || w.sport !== "run"));
  const generating = await db
    .select({ id: activities.id })
    .from(activities)
    .where(inArray(activities.analysisStatus, ["pending", "running"]));

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted">{dateLine}</p>
        {health && <Readiness hrv={health.hrvMs} hrvStatus={health.hrvStatus} sleepSec={health.sleepSec} />}
      </div>

      {viewingDay ? daySessions(week, surface) : completedRunHero ?? (main ? (
        <article className="session-feature mt-4">
          <Link href={`/workout/${main.id}`}>
            <h1 className="text-[30px] leading-tight font-semibold tracking-tight">{main.title}</h1>
          </Link>
          <p className="mt-1 text-muted">{main.key ? "Key session" : sessionKind(main.type)}</p>
          <WorkoutHero workout={main} surface={surface} />
          <div className="mt-6">
            <StartTreadmill workoutId={main.id} quiet={surface !== "treadmill"}>
              Start on the treadmill
            </StartTreadmill>
          </div>
        </article>
      ) : next ? (
        <article className="session-feature mt-4">
          <p className="text-sm text-muted">Next run, {formatDay(next.date)}</p>
          <Link href={`/workout/${next.id}`}>
            <h1 className="text-[30px] leading-tight font-semibold tracking-tight">{next.title}</h1>
          </Link>
          <WorkoutHero workout={next} surface={surface} />
        </article>
      ) : (
        <h1 className="mt-1 text-[30px] leading-tight font-semibold tracking-tight">{todays.length ? "Today’s sessions" : "Rest day"}</h1>
      ))}
      {!viewingDay && otherWorkouts.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {otherWorkouts.map((workout) => (
            <li key={workout.id}>
              <TextLink href={`/workout/${workout.id}`}>{workout.title}</TextLink>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <Link href="/coach" className="mt-8 block rounded-2xl border border-ink px-4 py-3">
          <span className="font-medium">
            {pending.length === 1 ? "Your coach suggests a plan change" : `${pending.length} plan changes to review`}
          </span>
          <span className="block text-sm text-muted">Review it before it takes effect.</span>
        </Link>
      )}

      {weekOverview(week)}

      {generating.length > 0 && (
        <p className="mt-6 text-sm text-muted">
          Analysing your latest session…
          <AutoRefresh seconds={15} />
        </p>
      )}

      {latest && (
        <Section title={latest.kind === "weekly" ? "Weekly review" : "Latest analysis"}>
          <Link href={latest.activityId ? `/activities/${latest.activityId}` : "/coach"} className="block">
            <Panel>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-medium">{latest.title}</h3>
                {latest.score != null && <span className="num text-2xl">{latest.score}</span>}
              </div>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{latest.summary}</p>
            </Panel>
          </Link>
        </Section>
      )}

      <p className="mt-10 text-sm text-muted">
        <Link href="/treadmill" className="text-ink underline decoration-line underline-offset-4">
          Treadmill run without a plan
        </Link>
      </p>
      <p className="mt-3 text-sm text-muted">
        {goal.name}, {formatDay(goal.eventDate, { day: "numeric", month: "long", year: "numeric" })}
      </p>
    </>
  );
}

function sessionKind(type: string) {
  const map: Record<string, string> = {
    easy: "Easy",
    recovery: "Recovery",
    long: "Long session",
    endurance: "Endurance",
    strides: "Easy with strides",
    strength: "Strength",
    cross: "Cross-training",
  };
  return map[type] ?? type.replace("_", " ").replace(/^./, (c) => c.toUpperCase());
}

function Readiness({ hrv, hrvStatus, sleepSec }: { hrv: number | null; hrvStatus: string | null; sleepSec: number | null }) {
  const low = hrvStatus && /low|poor|unbalanced/i.test(hrvStatus);
  return (
    <div className="text-right text-sm">
      {hrv && (
        <div className={low ? "text-warn" : "text-ink"}>
          HRV <span className="num">{Math.round(hrv)}</span>
          {hrvStatus && <span className="text-muted"> {hrvStatus.toLowerCase()}</span>}
        </div>
      )}
      {sleepSec && (
        <div className="text-muted">
          Slept <span className="num text-ink">{Math.floor(sleepSec / 3600)}:{String(Math.round((sleepSec % 3600) / 60)).padStart(2, "0")}</span>
        </div>
      )}
    </div>
  );
}

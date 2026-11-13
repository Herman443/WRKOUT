import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { SubmitButton } from "@/components/submit-button";
import { Panel, PageTitle, Section, Skeleton, StartTreadmill, TextLink } from "@/components/ui";
import { WeekStrip } from "@/components/week-strip";
import { WorkoutHero } from "@/components/workout-hero";
import { db } from "@/db";
import { activities, analyses, dailyHealth, planChanges } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { addDays, formatDay, startOfWeek, todayLocal } from "@/lib/dates";
import { getKv } from "@/lib/ingest";
import { getActivePlan, workoutsBetween } from "@/lib/plan-store";
import type { RunSurface } from "@/lib/training/treadmill";
import { formatDuration } from "@/lib/training/vdot";
import { retryPlan } from "./actions";

export default function TodayPage() {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <Today />
    </Suspense>
  );
}

async function Today() {
  await requireSession();
  const today = todayLocal();
  const active = await getActivePlan();
  const dateLine = formatDay(today, { weekday: "long", day: "numeric", month: "long" });

  if (!active) {
    return (
      <>
        <PageTitle sub={dateLine}>Set a goal to get your plan</PageTitle>
        <p className="mt-3 max-w-prose text-muted">
          Pick a race or event, tell the coach about your week and your current speed, and it builds the training up to race day.
        </p>
        <Link href="/onboarding" className="mt-6 inline-block rounded-xl bg-ink px-5 py-3 font-medium text-fog">
          Choose a goal
        </Link>
      </>
    );
  }

  const { plan, goal } = active;
  if (plan.status === "generating" || plan.status === "failed") {
    return (
      <>
        <PageTitle sub={dateLine}>{plan.status === "failed" ? "The plan could not be built" : "Building your plan"}</PageTitle>
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
      </>
    );
  }

  const weekStart = startOfWeek(today);
  const [week, [health], pending, [latest], surface] = await Promise.all([
    workoutsBetween(plan.id, weekStart, addDays(weekStart, 6)),
    db.select().from(dailyHealth).where(eq(dailyHealth.date, today)),
    db.select({ id: planChanges.id }).from(planChanges).where(eq(planChanges.status, "pending")),
    db.select().from(analyses).orderBy(desc(analyses.createdAt)).limit(1),
    getKv<RunSurface>("run_surface").then((s) => s ?? "outdoor"),
  ]);
  const todays = week.filter((w) => w.date === today && w.status !== "skipped");
  const main = todays.find((w) => w.status === "planned") ?? todays[0];
  const next = main
    ? null
    : (await workoutsBetween(plan.id, addDays(today, 1), addDays(today, 7))).find((w) => w.status === "planned");
  const doneActivity =
    main?.status === "completed" && main.activityId
      ? (await db.select().from(activities).where(eq(activities.id, main.activityId)))[0]
      : null;
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

      {main ? (
        <article className="mt-1">
          <Link href={`/workout/${main.id}`}>
            <h1 className="text-[30px] leading-tight font-semibold tracking-tight">{main.title}</h1>
          </Link>
          {main.status === "completed" ? (
            <p className="mt-1 text-good">
              Done{doneActivity ? `, ${formatDuration(doneActivity.durationSec)}` : ""}
              {doneActivity?.compliance ? `, plan match ${doneActivity.compliance.score}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-muted">{main.key ? "Key session" : sessionKind(main.type)}</p>
          )}
          <WorkoutHero workout={main} surface={surface} />
          {main.sport === "run" && main.status === "planned" && (
            <div className="mt-6">
              <StartTreadmill workoutId={main.id} quiet={surface !== "treadmill"}>
                Start on the treadmill
              </StartTreadmill>
            </div>
          )}
          {todays.length > 1 && (
            <p className="mt-4 text-sm text-muted">
              Also today:{" "}
              {todays
                .filter((w) => w.id !== main.id)
                .map((w) => (
                  <Link key={w.id} href={`/workout/${w.id}`} className="text-ink underline decoration-line underline-offset-4">
                    {w.title}
                  </Link>
                ))}
            </p>
          )}
        </article>
      ) : (
        <article className="mt-1">
          <h1 className="text-[30px] leading-tight font-semibold tracking-tight">Rest day</h1>
          <p className="mt-1 text-muted">Recovery is where the training lands.</p>
          {next && (
            <Panel className="mt-6">
              <p className="text-sm text-muted">Next up, {formatDay(next.date)}</p>
              <Link href={`/workout/${next.id}`} className="mt-1 block text-lg font-medium">
                {next.title}
              </Link>
              <WorkoutHero workout={next} compact surface={surface} />
            </Panel>
          )}
        </article>
      )}

      {pending.length > 0 && (
        <Link href="/coach" className="mt-8 block rounded-2xl border border-ink px-4 py-3">
          <span className="font-medium">
            {pending.length === 1 ? "Your coach suggests a plan change" : `${pending.length} plan changes to review`}
          </span>
          <span className="block text-sm text-muted">Review it before it takes effect.</span>
        </Link>
      )}

      <Section title="This week" action={<TextLink href="/plan">Full plan</TextLink>}>
        <WeekStrip weekStart={weekStart} today={today} workouts={week} />
      </Section>

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

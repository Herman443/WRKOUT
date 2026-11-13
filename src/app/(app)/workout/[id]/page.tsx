import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Panel, Skeleton, inputClass } from "@/components/ui";
import { WorkoutHero } from "@/components/workout-hero";
import { db } from "@/db";
import { activities, plannedWorkouts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { addDays, formatDay, startOfWeek, todayLocal } from "@/lib/dates";
import { formatDuration } from "@/lib/training/vdot";
import { moveWorkout, setWorkoutStatus } from "../../actions";

export default function WorkoutPage({ params }: PageProps<"/workout/[id]">) {
  return (
    <Suspense fallback={<Skeleton lines={5} />}>
      <Workout params={params} />
    </Suspense>
  );
}

const SPORT: Record<string, string> = { run: "Run", bike: "Ride", swim: "Swim", strength: "Strength", other: "Session" };

async function Workout({ params }: Pick<PageProps<"/workout/[id]">, "params">) {
  await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [w] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, id));
  if (!w) notFound();
  const [activity] = w.activityId ? await db.select().from(activities).where(eq(activities.id, w.activityId)) : [];
  const today = todayLocal();
  const weekEnd = addDays(startOfWeek(w.date), 6);
  const canChange = w.status !== "completed" && w.date >= today;

  return (
    <>
      <Link href="/" className="-ml-1 inline-flex items-center gap-0.5 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden /> Today
      </Link>
      <p className="mt-3 text-sm text-muted">
        {formatDay(w.date, { weekday: "long", day: "numeric", month: "long" })}, {SPORT[w.sport] ?? w.sport}
        {w.key ? ", key session" : ""}
      </p>
      <h1 className="mt-0.5 text-[30px] leading-tight font-semibold tracking-tight">{w.title}</h1>
      {w.status === "skipped" && <p className="mt-1 text-warn">Skipped</p>}
      {w.status === "missed" && <p className="mt-1 text-warn">Not done</p>}

      <WorkoutHero workout={w} />

      {activity && (
        <Link href={`/activities/${activity.id}`} className="mt-8 block">
          <Panel>
            <p className="text-sm text-muted">Completed</p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-medium">{activity.name}</span>
              <span className="num text-xl">{formatDuration(activity.durationSec)}</span>
            </div>
            {activity.compliance && <p className="mt-1 text-sm text-muted">Plan match {activity.compliance.score}. See the analysis.</p>}
          </Panel>
        </Link>
      )}

      {canChange && (
        <div className="mt-10 space-y-4">
          <form action={moveWorkout} className="flex items-end gap-2">
            <input type="hidden" name="id" value={w.id} />
            <label className="flex-1">
              <span className="text-sm text-muted">Move to</span>
              <input type="date" name="date" min={today} max={weekEnd} defaultValue={w.date} className={`${inputClass} mt-1`} />
            </label>
            <SubmitButton variant="quiet" pendingText="Moving…">
              Move
            </SubmitButton>
          </form>
          <form action={setWorkoutStatus}>
            <input type="hidden" name="id" value={w.id} />
            {w.status === "skipped" ? (
              <SubmitButton variant="quiet" name="status" value="planned">
                Put back in the plan
              </SubmitButton>
            ) : (
              <SubmitButton variant="danger" name="status" value="skipped">
                Skip this session
              </SubmitButton>
            )}
          </form>
          <p className="text-sm text-muted">
            Bigger changes, like travel or a sore calf, are better told to the{" "}
            <Link href="/coach" className="text-ink underline decoration-line underline-offset-4">
              coach
            </Link>
            .
          </p>
        </div>
      )}
    </>
  );
}

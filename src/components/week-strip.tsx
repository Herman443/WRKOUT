import { Check } from "lucide-react";
import Link from "next/link";
import type { Activity, PlannedWorkout } from "@/db/schema";
import { addDays, WEEKDAYS } from "@/lib/dates";
import { compactDuration } from "@/lib/training/vdot";
import { RecordedRuns } from "./recorded-runs";
import { Silhouette } from "./silhouette";

/** Monday–Sunday, showing recorded runs or the day's planned session. */
export function WeekStrip({ weekStart, today, workouts, runs }: {
  weekStart: string;
  today: string;
  workouts: PlannedWorkout[];
  runs: Pick<Activity, "id" | "localDate" | "name" | "durationSec" | "distanceM" | "startTime">[];
}) {
  return (
    <ol className="relative grid grid-cols-7 gap-1.5">
      {WEEKDAYS.map((d, i) => {
        const date = addDays(weekStart, i);
        const day = workouts.filter((w) => w.date === date && w.status !== "skipped");
        const main = day.find((w) => w.sport !== "strength") ?? day[0];
        const dayRuns = runs.filter((run) => run.localDate === date);
        const run = dayRuns[0];
        const done = !!run || main?.status === "completed";
        const faded = main?.status === "missed" || (date < today && !done);
        const isToday = date === today;
        const inner = (
          <div
            className={`flex h-[5.25rem] flex-col rounded-xl px-1.5 pt-1.5 pb-1 ${isToday ? "bg-paper ring-1 ring-ink" : "bg-paper"}`}
          >
            <div className="flex items-baseline justify-between text-[11px] text-muted">
              <span>{d.slice(0, 2)}</span>
              <span className="num text-xs text-ink">{Number(date.slice(8))}</span>
            </div>
            <div className="mt-auto">
              {run ? (
                <div className="num text-center text-xs">
                  {dayRuns.length > 1 ? `${dayRuns.length} runs` : run.distanceM ? `${(run.distanceM / 1000).toFixed(1)} km` : compactDuration(run.durationSec)}
                </div>
              ) : main ? (
                <Silhouette
                  structure={main.structure}
                  type={main.type}
                  plannedDurationSec={main.plannedDurationSec}
                  height={30}
                  gap={1}
                  muted={faded}
                />
              ) : (
                <div className="mb-1 h-1 rounded-full bg-line" aria-hidden />
              )}
            </div>
            <div className="mt-1 flex h-3.5 items-center justify-center text-good">
              {done && <Check size={14} strokeWidth={3} aria-label="Done" />}
            </div>
          </div>
        );
        return (
          <li key={date}>
            {dayRuns.length > 1 ? (
              <details name="week-strip-runs">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  {inner}
                </summary>
                <div className="absolute inset-x-0 z-10 mt-2 rounded-xl border border-line bg-paper px-3 shadow-lg">
                  <RecordedRuns runs={dayRuns} />
                </div>
              </details>
            ) : run ? (
              <Link href={`/activities/${run.id}`} aria-label={`${d} ${date}: ${run.name}, completed`}>
                {inner}
              </Link>
            ) : main ? (
              <Link href={`/workout/${main.id}`} aria-label={`${d} ${date}: ${main.title}`}>
                {inner}
              </Link>
            ) : (
              <div aria-label={`${d} ${date}: rest`}>{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

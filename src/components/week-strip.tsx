import { Check } from "lucide-react";
import Link from "next/link";
import type { Activity, PlannedWorkout } from "@/db/schema";
import { addDays, formatDay, WEEKDAYS } from "@/lib/dates";
import { compactDuration } from "@/lib/training/vdot";
import { Silhouette } from "./silhouette";

/** Monday–Sunday, showing recorded runs or the day's planned session. */
export function WeekStrip({ weekStart, today, selectedDate, workouts, runs }: {
  weekStart: string;
  today: string;
  selectedDate: string;
  workouts: PlannedWorkout[];
  runs: Pick<Activity, "id" | "localDate" | "name" | "durationSec" | "distanceM" | "startTime">[];
}) {
  return (
    <ol className="week-strip grid grid-cols-7 gap-1">
      {WEEKDAYS.map((d, i) => {
        const date = addDays(weekStart, i);
        const day = workouts.filter((w) => w.date === date && w.status !== "skipped");
        const main = day.find((w) => w.sport !== "strength") ?? day[0];
        const dayRuns = runs.filter((run) => run.localDate === date);
        const run = dayRuns[0];
        const done = !!run || main?.status === "completed";
        const faded = main?.status === "missed" || (date < today && !done);
        return (
          <li key={date}>
            <Link
              href={`/?day=${date}`}
              scroll={false}
              aria-label={formatDay(date, { weekday: "long", day: "numeric", month: "long" })}
              aria-current={date === selectedDate ? "true" : undefined}
              className="week-day flex h-28 flex-col rounded-xl px-1 pt-2 pb-2"
            >
              <div className="flex flex-col items-center gap-1 text-[11px] text-muted">
                <span>{d.slice(0, 2)}</span>
                <span className="num text-xl text-ink">{Number(date.slice(8))}</span>
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
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

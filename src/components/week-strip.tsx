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
    <ol className="grid grid-cols-7 gap-1.5">
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
              className={`flex h-[5.25rem] flex-col rounded-xl bg-paper px-1.5 pt-1.5 pb-1 ${date === selectedDate ? "ring-1 ring-ink" : ""}`}
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
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

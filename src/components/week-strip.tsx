import { Check } from "lucide-react";
import Link from "next/link";
import type { PlannedWorkout } from "@/db/schema";
import { addDays, WEEKDAYS } from "@/lib/dates";
import { Silhouette } from "./silhouette";

/** Monday–Sunday, each day showing its main session as a tiny silhouette. */
export function WeekStrip({ weekStart, today, workouts }: { weekStart: string; today: string; workouts: PlannedWorkout[] }) {
  return (
    <ol className="grid grid-cols-7 gap-1.5">
      {WEEKDAYS.map((d, i) => {
        const date = addDays(weekStart, i);
        const day = workouts.filter((w) => w.date === date && w.status !== "skipped");
        const main = day.find((w) => w.sport !== "strength") ?? day[0];
        const done = main?.status === "completed";
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
              {main ? (
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
            {main ? (
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

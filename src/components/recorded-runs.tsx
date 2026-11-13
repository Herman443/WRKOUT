import { Check } from "lucide-react";
import Link from "next/link";
import type { Activity } from "@/db/schema";
import { formatDay, localTime } from "@/lib/dates";
import { compactDuration } from "@/lib/training/vdot";

export function RecordedRuns({ runs }: {
  runs: Pick<Activity, "id" | "localDate" | "name" | "durationSec" | "distanceM" | "startTime">[];
}) {
  return (
    <ul className="divide-y divide-line">
      {runs.map((run) => {
        const { hour, minute } = localTime(run.startTime);
        return (
          <li key={run.id}>
            <Link href={`/activities/${run.id}`} className="flex items-center gap-3 py-2.5">
              <Check size={16} className="shrink-0 text-good" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{run.name}</span>
                <span className="block text-sm text-muted">{formatDay(run.localDate)} · {hour}:{String(minute).padStart(2, "0")}</span>
              </span>
              <span className="num shrink-0 text-right">
                {run.distanceM ? `${(run.distanceM / 1000).toFixed(1)} km` : compactDuration(run.durationSec)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

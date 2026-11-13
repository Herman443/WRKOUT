import { desc } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle, Skeleton, StartTreadmill } from "@/components/ui";
import { db } from "@/db";
import { activities } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { formatDay } from "@/lib/dates";
import { isTreadmill, paceTrusted } from "@/lib/training/treadmill";
import { compactDuration } from "@/lib/training/vdot";

export default function ActivitiesPage() {
  return (
    <Suspense fallback={<Skeleton lines={8} />}>
      <Activities />
    </Suspense>
  );
}

async function Activities() {
  await requireSession();
  const rows = await db.select().from(activities).orderBy(desc(activities.startTime)).limit(60);
  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <PageTitle sub="Synced from Garmin and Strava">Activities</PageTitle>
        <StartTreadmill quiet>Treadmill run</StartTreadmill>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-muted">Nothing synced yet. New sessions appear here within about 15 minutes of reaching Garmin.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line">
          {rows.map((a) => (
            <li key={a.id}>
              <Link href={`/activities/${a.id}`} className="flex items-center gap-3 py-3">
                <span className="w-16 shrink-0 text-sm text-muted">{formatDay(a.localDate, { day: "numeric", month: "short" })}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{a.name}</span>
                  <span className="block text-sm text-muted">
                    {a.analysisStatus === "done"
                      ? "Analysed"
                      : a.analysisStatus === "pending" || a.analysisStatus === "running"
                        ? "Analysing…"
                        : a.analysisStatus === "failed"
                          ? "Analysis failed"
                          : "Logged"}
                    {a.sport === "run" && isTreadmill(a.subSport) && !paceTrusted(a) && <span className="text-warn">, check treadmill distance</span>}
                  </span>
                </span>
                <span className="num shrink-0 text-right text-lg">
                  {a.distanceM ? `${(a.distanceM / 1000).toFixed(1)} km` : compactDuration(a.durationSec)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

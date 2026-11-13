import { desc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { SubmitButton } from "@/components/submit-button";
import { Field, Panel, Section, Skeleton, Stat, inputClass } from "@/components/ui";
import { db } from "@/db";
import { activities, analyses, planChanges, plannedWorkouts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { formatDay } from "@/lib/dates";
import { formatDuration, formatPace } from "@/lib/training/vdot";
import { saveFeedback } from "../../actions";

export default function ActivityPage({ params }: PageProps<"/activities/[id]">) {
  return (
    <Suspense fallback={<Skeleton lines={5} />}>
      <ActivityView params={params} />
    </Suspense>
  );
}

async function ActivityView({ params }: Pick<PageProps<"/activities/[id]">, "params">) {
  await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [a] = await db.select().from(activities).where(eq(activities.id, id));
  if (!a) notFound();
  const [analysis] = await db.select().from(analyses).where(eq(analyses.activityId, id)).orderBy(desc(analyses.createdAt)).limit(1);
  const [planned] = a.plannedWorkoutId ? await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, a.plannedWorkoutId)) : [];
  const [change] = analysis?.changeId ? await db.select().from(planChanges).where(eq(planChanges.id, analysis.changeId)) : [];
  const pace = a.sport === "run" && a.distanceM ? (a.movingSec ?? a.durationSec) / (a.distanceM / 1000) : null;
  const speed = a.sport === "bike" && a.distanceM ? a.distanceM / 1000 / ((a.movingSec ?? a.durationSec) / 3600) : null;
  const working = a.analysisStatus === "pending" || a.analysisStatus === "running";

  return (
    <>
      <Link href="/activities" className="-ml-1 inline-flex items-center gap-0.5 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden /> Activities
      </Link>
      <p className="mt-3 text-sm text-muted">
        {formatDay(a.localDate, { weekday: "long", day: "numeric", month: "long" })}
        {planned && (
          <>
            , planned as{" "}
            <Link href={`/workout/${planned.id}`} className="text-ink underline decoration-line underline-offset-4">
              {planned.title}
            </Link>
          </>
        )}
      </p>
      <h1 className="mt-0.5 text-[30px] leading-tight font-semibold tracking-tight">{a.name}</h1>

      <div className="mt-6 grid grid-cols-3 gap-y-5">
        {a.distanceM && <Stat value={(a.distanceM / 1000).toFixed(2)} unit="km" label="Distance" />}
        <Stat value={formatDuration(a.movingSec ?? a.durationSec)} label="Time" />
        {pace && <Stat value={formatPace(pace)} unit="/km" label="Pace" />}
        {speed && <Stat value={speed.toFixed(1)} unit="km/h" label="Speed" />}
        {a.avgHr && <Stat value={a.avgHr} unit="bpm" label="Avg heart rate" />}
        {a.normalizedPowerW && <Stat value={a.normalizedPowerW} unit="W" label="Normalised power" />}
        {a.load != null && <Stat value={Math.round(a.load)} label="Training load" />}
        {a.compliance && <Stat value={a.compliance.score} label="Plan match" />}
      </div>

      <Section title="Coach's analysis">
        {analysis ? (
          <Panel>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-medium">{analysis.title}</h3>
              {analysis.score != null && <span className="num text-3xl">{analysis.score}</span>}
            </div>
            <p className="mt-2 text-[15px] leading-relaxed">{analysis.summary}</p>
            {analysis.highlights.length > 0 && (
              <ul className="mt-3 space-y-1 text-[15px]">
                {analysis.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-good" aria-hidden />
                    {h}
                  </li>
                ))}
              </ul>
            )}
            {analysis.concerns.length > 0 && (
              <ul className="mt-2 space-y-1 text-[15px]">
                {analysis.concerns.map((h, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                    {h}
                  </li>
                ))}
              </ul>
            )}
            {change && (
              <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
                {change.status === "applied" ? "Plan adjusted: " : change.status === "pending" ? "Suggested change, waiting for you: " : "Suggested: "}
                {change.rationale}
                {change.status === "pending" && (
                  <>
                    {" "}
                    <Link href="/coach" className="text-ink underline decoration-line underline-offset-4">
                      Review
                    </Link>
                  </>
                )}
              </p>
            )}
          </Panel>
        ) : working ? (
          <p className="text-muted">
            Your coach is looking at this session.
            <AutoRefresh seconds={10} />
          </p>
        ) : (
          <p className="text-muted">
            {a.analysisStatus === "failed" ? "The analysis failed. Save feedback below to try again." : "Older sessions are logged without an analysis."}
          </p>
        )}
      </Section>

      <Section title="How did it feel?">
        <form action={saveFeedback} className="space-y-3">
          <input type="hidden" name="id" value={a.id} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Effort, 1–10">
              <input name="rpe" type="number" min={1} max={10} defaultValue={a.rpe ?? ""} className={inputClass} />
            </Field>
            <Field label="Feel">
              <select name="feel" defaultValue={a.feel ?? ""} className={inputClass}>
                <option value="">Choose</option>
                <option value="great">Great</option>
                <option value="good">Good</option>
                <option value="ok">OK</option>
                <option value="tired">Tired</option>
                <option value="sore">Sore or niggly</option>
                <option value="ill">Unwell</option>
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea name="notes" rows={2} defaultValue={a.notes ?? ""} className={inputClass} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton variant="quiet" pendingText="Saving…">
              Save
            </SubmitButton>
            <SubmitButton name="reanalyze" value="1" pendingText="Sending…">
              Save and re-analyse
            </SubmitButton>
          </div>
        </form>
      </Section>

      {a.laps.length > 1 && (
        <Section title="Laps">
          <table className="w-full text-right">
            <thead className="text-sm text-muted">
              <tr>
                <th className="py-1 text-left font-normal">Lap</th>
                <th className="font-normal">Time</th>
                <th className="font-normal">Dist</th>
                <th className="font-normal">{a.sport === "bike" ? "Power" : "Pace"}</th>
                <th className="font-normal">HR</th>
              </tr>
            </thead>
            <tbody className="num">
              {a.laps.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 text-left">{i + 1}</td>
                  <td>{formatDuration(l.durationSec)}</td>
                  <td>{l.distanceM ? (l.distanceM / 1000).toFixed(2) : ""}</td>
                  <td>{a.sport === "bike" ? (l.avgPower ? Math.round(l.avgPower) : "") : l.distanceM ? formatPace(l.durationSec / (l.distanceM / 1000)) : ""}</td>
                  <td>{l.avgHr ? Math.round(l.avgHr) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}

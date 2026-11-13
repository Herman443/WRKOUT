import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LiveTreadmill } from "@/components/live-treadmill";
import { KIND_LABEL, formatTarget } from "@/components/steps";
import { Skeleton } from "@/components/ui";
import { db } from "@/db";
import { plannedWorkouts } from "@/db/schema";
import { deriveMarkers } from "@/lib/athlete";
import { requireSession } from "@/lib/auth";
import { getProfile } from "@/lib/plan-store";
import { stepLevel } from "@/lib/training/intensity";
import { formatKmh, kmhFromPace } from "@/lib/training/treadmill";
import { round1, stepKmh, type LiveStep } from "@/lib/training/treadmill-live";
import { flattenSteps, type SimpleStep, type WorkoutType } from "@/lib/training/workout-structure";

export default function TreadmillPage({ searchParams }: PageProps<"/treadmill">) {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <Treadmill searchParams={searchParams} />
    </Suspense>
  );
}

async function Treadmill({ searchParams }: Pick<PageProps<"/treadmill">, "searchParams">) {
  await requireSession();
  const { workout } = await searchParams;
  const id = typeof workout === "string" && /^[0-9a-f-]{36}$/i.test(workout) ? workout : null;
  const [w] = id ? await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, id)) : [];
  if (id && (!w || w.sport !== "run")) notFound();

  const easy = deriveMarkers(await getProfile()).zones.runPaces?.easy;
  const startKmh = easy ? round1(kmhFromPace((easy[0] + easy[1]) / 2)) : 10;

  // A planned session without steps still gets one, so its length counts down.
  const structure: SimpleStep[] = w
    ? w.structure.length
      ? flattenSteps(w.structure)
      : w.plannedDurationSec
        ? [{ kind: "work", duration: { type: "time", value: w.plannedDurationSec }, target: { type: "none", zone: null, low: null, high: null }, note: null }]
        : []
    : [];
  // Easy steps without a pace target start at easy pace rather than staying at the last rep's speed.
  const easyKmh: [number, number] | null = easy ? [round1(kmhFromPace(easy[1])), round1(kmhFromPace(easy[0]))] : null;
  const steps: LiveStep[] = structure.map((s) => {
    const fallback = !stepKmh(s) && easyKmh && ["warmup", "recovery", "cooldown"].includes(s.kind);
    return {
      kind: s.kind,
      label: [KIND_LABEL[s.kind], s.target.type !== "none" && s.target.zone ? s.target.zone.toLowerCase() : null].filter(Boolean).join(" "),
      duration: s.duration,
      kmh: stepKmh(s) ?? (fallback ? easyKmh : null),
      target: formatTarget(s.target, true) || (fallback ? `${formatKmh(easyKmh[0])}–${formatKmh(easyKmh[1])} km/h easy` : null),
      note: s.note,
      level: stepLevel(s, w!.type as WorkoutType),
    };
  });

  return (
    <LiveTreadmill
      workoutId={w?.id ?? null}
      title={w?.title ?? "Treadmill run"}
      steps={steps}
      startKmh={startKmh}
      backHref={w ? `/workout/${w.id}` : "/"}
    />
  );
}

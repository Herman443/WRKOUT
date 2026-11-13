import { setRunSurface } from "@/app/(app)/actions";
import type { PlannedWorkout } from "@/db/schema";
import { formatKmh, kmhFromPace, type RunSurface } from "@/lib/training/treadmill";
import { flattenSteps } from "@/lib/training/workout-structure";
import { formatPace } from "@/lib/training/vdot";
import { Silhouette } from "./silhouette";
import { StepList } from "./steps";
import { Stat } from "./ui";

function durationStat(sec: number | null) {
  if (!sec) return null;
  const min = Math.round(sec / 60);
  if (min < 100) return { value: String(min), unit: "min" };
  return { value: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`, unit: "h" };
}

/** The main work target of a session, e.g. "4:15 /km" at threshold. */
function keyTarget(w: PlannedWorkout, treadmill: boolean) {
  const work = flattenSteps(w.structure).filter((s) => s.kind === "work" && s.target.type !== "none");
  const hardest = work.sort((a, b) => (a.target.low ?? 9999) - (b.target.low ?? 9999))[0];
  if (!hardest) return null;
  const t = hardest.target;
  if (t.type === "pace" && t.low && treadmill) return { value: formatKmh(kmhFromPace(t.low)), unit: "km/h", label: "Work speed" };
  if (t.type === "pace" && t.low) return { value: formatPace(t.low), unit: "/km", label: "Work pace" };
  if (t.type === "power" && t.low) return { value: `${Math.round(t.low)}`, unit: "W", label: t.zone ?? "Power" };
  if (t.type === "hr" && t.high) return { value: `≤${Math.round(t.high)}`, unit: "bpm", label: t.zone ?? "Heart rate" };
  return null;
}

function SurfaceToggle({ surface }: { surface: RunSurface }) {
  const option = (value: RunSurface, label: string) => (
    <button
      type="submit"
      name="surface"
      value={value}
      aria-pressed={surface === value}
      className={`surface-option rounded-lg px-3 py-2.5 text-sm font-medium ${surface === value ? "bg-paper text-ink shadow-sm" : "text-muted"}`}
    >
      {label}
    </button>
  );
  return (
    <form action={setRunSurface} className="inline-flex rounded-xl bg-line/60 p-0.5">
      {option("outdoor", "Outside")}
      {option("treadmill", "Treadmill")}
    </form>
  );
}

export function WorkoutHero({
  workout,
  compact = false,
  surface,
}: {
  workout: PlannedWorkout;
  compact?: boolean;
  /** Where the athlete runs; for run sessions, "treadmill" shows targets as belt speed. */
  surface?: RunSurface;
}) {
  const isRun = workout.sport === "run";
  const treadmill = isRun && surface === "treadmill";
  const d = durationStat(workout.plannedDurationSec);
  const t = keyTarget(workout, treadmill);
  return (
    <div>
      <Silhouette
        structure={workout.structure}
        type={workout.type}
        plannedDurationSec={workout.plannedDurationSec}
        height={compact ? 56 : 104}
        className={compact ? "mt-5" : "workout-profile mt-5"}
      />
      <div className={`mt-5 flex flex-wrap gap-x-6 gap-y-4 ${compact ? "" : "workout-stats"}`}>
        {d && <Stat value={d.value} unit={d.unit} label="Duration" />}
        {workout.plannedDistanceM && <Stat value={(workout.plannedDistanceM / 1000).toFixed(1)} unit="km" label="Distance" />}
        {t && <Stat value={t.value} unit={t.unit} label={t.label} />}
      </div>
      {!compact && (
        <>
          {isRun && surface && (
            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
              <SurfaceToggle surface={surface} />
              {treadmill && <p className="text-sm text-muted">Belt speeds. Set 1% incline to match the effort outside.</p>}
            </div>
          )}
          <div className={isRun && surface ? "mt-3" : "mt-6"}>
            <StepList structure={workout.structure} type={workout.type} treadmill={treadmill} />
          </div>
          {workout.purpose && <p className="mt-5 max-w-prose text-[15px] leading-relaxed">{workout.purpose}</p>}
          {workout.description && <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted">{workout.description}</p>}
        </>
      )}
    </div>
  );
}

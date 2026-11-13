import { stepLevel, LEVEL_COLOR } from "@/lib/training/intensity";
import { formatKmh, kmhFromPace } from "@/lib/training/treadmill";
import { formatDuration, formatPace } from "@/lib/training/vdot";
import type { SimpleStep, Step, Target, WorkoutType } from "@/lib/training/workout-structure";

export const KIND_LABEL: Record<SimpleStep["kind"], string> = {
  warmup: "Warm up",
  work: "Work",
  recovery: "Recover",
  rest: "Rest",
  cooldown: "Cool down",
};

/** `treadmill` shows pace as belt speed, slowest first. */
export function formatTarget(t: Target, treadmill = false): string {
  const range = (lo: number | null, hi: number | null, fmt: (n: number) => string) =>
    lo && hi && fmt(lo) !== fmt(hi) ? `${fmt(lo)}–${fmt(hi)}` : lo ? fmt(lo) : hi ? fmt(hi) : "";
  switch (t.type) {
    case "pace": {
      if (treadmill) {
        const r = range(t.high, t.low, (n) => formatKmh(kmhFromPace(n)));
        return r ? `${r} km/h` : (t.zone ?? "");
      }
      const r = range(t.low, t.high, formatPace);
      return r ? `${r} /km` : (t.zone ?? "");
    }
    case "hr": {
      const r = range(t.low, t.high, (n) => String(Math.round(n)));
      return r ? `${r} bpm` : (t.zone ?? "");
    }
    case "power": {
      const r = range(t.low, t.high, (n) => String(Math.round(n)));
      return r ? `${r} W` : (t.zone ?? "");
    }
    case "rpe": {
      const r = range(t.low, t.high, (n) => String(n));
      return r ? `RPE ${r}` : "";
    }
    default:
      return t.zone ?? "";
  }
}

function formatStepDuration(s: SimpleStep) {
  if (s.duration.type === "time" && s.duration.value) return formatDuration(s.duration.value);
  if (s.duration.type === "distance" && s.duration.value)
    return s.duration.value >= 1000 ? `${+(s.duration.value / 1000).toFixed(2)} km` : `${s.duration.value} m`;
  return "Open";
}

function Row({ step, type, treadmill }: { step: SimpleStep; type: WorkoutType; treadmill: boolean }) {
  const level = stepLevel(step, type);
  const target = formatTarget(step.target, treadmill);
  return (
    <li className="flex items-baseline gap-3 py-2">
      <span className={`${LEVEL_COLOR[level]} mt-1 h-2.5 w-2.5 shrink-0 self-center rounded-full`} aria-hidden />
      <span className="num w-16 shrink-0 text-lg">{formatStepDuration(step)}</span>
      <span className="min-w-0 flex-1">
        <span className="text-ink">{KIND_LABEL[step.kind]}</span>
        {step.target.zone && step.target.type !== "none" && <span className="text-muted"> {step.target.zone.toLowerCase()}</span>}
        {step.note && <span className="block text-sm text-muted">{step.note}</span>}
      </span>
      {target && <span className="num shrink-0 text-right text-base">{target}</span>}
    </li>
  );
}

export function StepList({ structure, type, treadmill = false }: { structure: Step[]; type: string; treadmill?: boolean }) {
  if (structure.length === 0) return null;
  return (
    <ol className="divide-y divide-line">
      {structure.map((s, i) =>
        s.kind === "repeat" ? (
          <li key={i} className="py-2">
            <div className="num text-lg">{s.times} ×</div>
            <ol className="ml-3 border-l-2 border-line pl-3">
              {s.steps.map((inner, j) => (
                <Row key={j} step={inner} type={type as WorkoutType} treadmill={treadmill} />
              ))}
            </ol>
          </li>
        ) : (
          <Row key={i} step={s} type={type as WorkoutType} treadmill={treadmill} />
        ),
      )}
    </ol>
  );
}

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
    <li className="grid grid-cols-[0.625rem_minmax(0,1fr)] gap-x-3 py-4">
      <span className={`${LEVEL_COLOR[level]} mt-2 h-2.5 w-2.5 rounded-full`} aria-hidden />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="num text-lg">{formatStepDuration(step)}</span>
          {target && <span className="num text-base">{target}</span>}
        </div>
        <div className="mt-1">
        <span className="font-medium text-ink">{KIND_LABEL[step.kind]}</span>
        {step.target.zone && step.target.type !== "none" && <span className="text-muted"> {step.target.zone.toLowerCase()}</span>}
        </div>
        {step.note && <p className="mt-1 text-sm leading-relaxed text-muted">{step.note}</p>}
      </div>
    </li>
  );
}

export function StepList({ structure, type, treadmill = false }: { structure: Step[]; type: string; treadmill?: boolean }) {
  if (structure.length === 0) return null;
  return (
    <ol className="divide-y divide-line">
      {structure.map((s, i) =>
        s.kind === "repeat" ? (
          <li key={i} className="py-3">
            <div className="text-sm font-medium">Repeat {s.times} times</div>
            <ol className="mt-1 divide-y divide-line">
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

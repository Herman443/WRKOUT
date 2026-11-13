import { LEVEL_COLOR, silhouetteBars } from "@/lib/training/intensity";
import type { Step, WorkoutType } from "@/lib/training/workout-structure";

/**
 * A workout drawn as its intensity profile: each step is a bar, width by duration,
 * height and colour by intensity zone.
 */
export function Silhouette({
  structure,
  type,
  plannedDurationSec,
  height = 72,
  gap = 2,
  muted = false,
  className = "",
}: {
  structure: Step[];
  type: string;
  plannedDurationSec: number | null;
  height?: number;
  gap?: number;
  muted?: boolean;
  className?: string;
}) {
  const bars = silhouetteBars(structure, type as WorkoutType, plannedDurationSec);
  const total = bars.reduce((s, b) => s + b.seconds, 0) || 1;
  return (
    <div className={`flex items-end ${className}`} style={{ height, gap }} aria-hidden>
      {bars.map((b, i) => (
        <div
          key={i}
          className={`${muted ? "bg-line" : LEVEL_COLOR[b.level]} rounded-[3px]`}
          style={{ flexGrow: b.seconds / total, flexBasis: 0, minWidth: 3, height: `${18 + (b.level - 1) * 20.5}%` }}
        />
      ))}
    </div>
  );
}

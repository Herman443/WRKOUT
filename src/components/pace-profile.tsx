import type { Activity } from "@/db/schema";
import { formatPace } from "@/lib/training/vdot";

export function PaceProfile({ laps, estimated }: { laps: Activity["laps"]; estimated: boolean }) {
  const speeds = laps.map(({ distanceM, durationSec }) => durationSec > 0 && distanceM > 0 ? distanceM / durationSec : 0);
  const valid = speeds.filter((speed) => Number.isFinite(speed) && speed > 0);
  if (!valid.length) return <p className="mt-3 text-sm text-muted">Lap pacing unavailable</p>;

  const fastest = Math.max(...valid);
  const slowest = Math.min(...valid);
  const fastPace = formatPace(1000 / fastest);
  const slowPace = formatPace(1000 / slowest);
  return (
    <figure className="mt-3">
      <figcaption className="flex flex-wrap justify-between gap-x-3 text-sm text-muted">
        <span>{estimated ? "Estimated lap pace" : "Lap pace"}</span>
        <span>{fastPace}{slowPace !== fastPace && `–${slowPace}`} /km</span>
      </figcaption>
      <div className="mt-2 flex h-14 items-end gap-px border-b border-line" role="img"
        aria-label={speeds.map((speed, index) =>
          `Lap ${index + 1}: ${Number.isFinite(speed) && speed > 0 ? `${formatPace(1000 / speed)} per kilometer` : "pace unavailable"}`
        ).join(", ")}>
        {speeds.map((speed, index) => (
          <div
            key={index}
            className="min-w-0 flex-1 rounded-t-sm bg-good"
            style={{ height: Number.isFinite(speed) && speed > 0 ? `${100 * speed / fastest}%` : 0 }}
          />
        ))}
      </div>
    </figure>
  );
}

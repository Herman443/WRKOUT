import { toLocalDate } from "../dates";
import type { Sport } from "../training/workout-structure";
import type { GarminActivitySummary } from "./client";

export function sportFromGarmin(typeKey: string | undefined): Sport {
  const k = (typeKey ?? "").toLowerCase();
  if (k.includes("run") || k === "track_running" || k === "treadmill_running") return "run";
  if (k.includes("cycl") || k.includes("biking") || k.includes("ride") || k === "indoor_cycling") return "bike";
  if (k.includes("swim")) return "swim";
  if (k.includes("strength") || k.includes("hiit") || k.includes("weight")) return "strength";
  return "other";
}

/** Garmin "GMT" timestamps come as "YYYY-MM-DD HH:mm:ss" without a zone. */
export function parseGarminGmt(s: string): Date {
  return new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
}

export function mapActivitySummary(a: GarminActivitySummary) {
  const start = a.startTimeGMT ? parseGarminGmt(a.startTimeGMT) : new Date();
  const zoneSeconds = [1, 2, 3, 4, 5].map((z) => Number(a[`hrTimeInZone_${z}`] ?? 0));
  const typeKey = a.activityType?.typeKey;
  return {
    garminId: String(a.activityId),
    source: "garmin" as const,
    startTime: start,
    localDate: toLocalDate(start),
    sport: sportFromGarmin(typeKey),
    subSport: typeKey ?? null,
    name: a.activityName ?? typeKey ?? "Activity",
    durationSec: Math.round(a.elapsedDuration ?? a.duration ?? 0),
    movingSec: a.movingDuration ? Math.round(a.movingDuration) : null,
    distanceM: a.distance ?? null,
    elevationGainM: a.elevationGain ?? null,
    avgHr: a.averageHR ? Math.round(a.averageHR) : null,
    maxHr: a.maxHR ? Math.round(a.maxHR) : null,
    avgPowerW: a.avgPower ? Math.round(a.avgPower) : null,
    normalizedPowerW: a.normPower ? Math.round(a.normPower) : null,
    avgCadence: a.averageRunningCadenceInStepsPerMinute ?? a.averageBikingCadenceInRevPerMinute ?? null,
    calories: a.calories ? Math.round(a.calories) : null,
    hrZoneSeconds: zoneSeconds.some((s) => s > 0) ? zoneSeconds.map(Math.round) : null,
    extra: {
      aerobicTrainingEffect: a.aerobicTrainingEffect ?? null,
      anaerobicTrainingEffect: a.anaerobicTrainingEffect ?? null,
      garminTrainingLoad: a.activityTrainingLoad ?? null,
      vo2MaxEstimate: a.vO2MaxValue ?? null,
      startTimeLocal: a.startTimeLocal ?? null,
    },
  };
}

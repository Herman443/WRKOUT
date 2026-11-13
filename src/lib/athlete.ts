import type { AthleteProfile } from "@/db/schema";
import type { LoadMarkers } from "./training/load";
import { bestVdot, trainingPaces, vdotFromEasyPace } from "./training/vdot";
import { computeZones, type AthleteZones } from "./training/zones";

export interface Markers {
  vdot: number | null;
  vdotSource: "profile" | "race" | "easy pace" | null;
  thresholdPaceSecPerKm: number | null;
  zones: AthleteZones;
  load: LoadMarkers;
}

/** Everything derived from the athlete's fitness markers, in one place. */
export function deriveMarkers(p: AthleteProfile | null | undefined): Markers {
  let vdot: number | null = null;
  let vdotSource: Markers["vdotSource"] = null;
  if (p?.vdot) {
    vdot = p.vdot;
    vdotSource = "profile";
  } else {
    const fromRaces = bestVdot((p?.prs ?? []).filter((r) => r.sport === "run"));
    if (fromRaces) {
      vdot = fromRaces;
      vdotSource = "race";
    } else if (p?.zone2PaceSecPerKm) {
      vdot = vdotFromEasyPace(p.zone2PaceSecPerKm);
      vdotSource = "easy pace";
    }
  }
  const thresholdPaceSecPerKm = p?.thresholdPaceSecPerKm ?? (vdot ? Math.round(trainingPaces(vdot).threshold) : null);
  const zones = computeZones({
    vdot,
    maxHr: p?.maxHr,
    restingHr: p?.restingHr,
    lthrRun: p?.lthrRun,
    lthrBike: p?.lthrBike,
    ftp: p?.ftp,
  });
  return {
    vdot,
    vdotSource,
    thresholdPaceSecPerKm,
    zones,
    load: {
      ftp: p?.ftp,
      thresholdPaceSecPerKm,
      lthr: p?.lthrRun,
      restingHr: p?.restingHr,
      maxHr: p?.maxHr,
    },
  };
}

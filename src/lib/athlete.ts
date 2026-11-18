import type { AthleteProfile } from "@/db/schema";
import type { LearnedEasyPace } from "./training/easy-pace";
import type { LoadMarkers } from "./training/load";
import { bestVdot, trainingPaces, vdotFromEasyPace } from "./training/vdot";
import { computeZones, type AthleteZones } from "./training/zones";

export interface Markers {
  vdot: number | null;
  vdotSource: "profile" | "race" | "easy pace" | null;
  thresholdPaceSecPerKm: number | null;
  /** What sets the fast end of the easy band */
  easyPaceSource: "recent runs" | "zone 2 pace" | "model" | null;
  learnedEasyPace: LearnedEasyPace | null;
  zones: AthleteZones;
  load: LoadMarkers;
}

/**
 * Everything derived from the athlete's fitness markers, in one place. `learned` is the easy
 * pace from recent Z2 running (see getMarkers); it beats the typed zone 2 pace, which goes stale.
 */
export function deriveMarkers(p: AthleteProfile | null | undefined, learned: LearnedEasyPace | null = null): Markers {
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
    } else if (p?.zone2PaceSecPerKm || learned) {
      // A typed zone 2 pace keeps VDOT (and the faster paces) steady; a learned one only seeds it.
      vdot = vdotFromEasyPace(p?.zone2PaceSecPerKm ?? learned!.paceSecPerKm);
      vdotSource = "easy pace";
    }
  }
  const thresholdPaceSecPerKm = p?.thresholdPaceSecPerKm ?? (vdot ? Math.round(trainingPaces(vdot).threshold) : null);
  const zones = computeZones({
    vdot,
    zone2PaceSecPerKm: learned?.paceSecPerKm ?? p?.zone2PaceSecPerKm,
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
    easyPaceSource: !vdot ? null : learned ? "recent runs" : p?.zone2PaceSecPerKm ? "zone 2 pace" : "model",
    learnedEasyPace: learned,
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

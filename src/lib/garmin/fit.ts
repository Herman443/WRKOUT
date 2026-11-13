import { Decoder, Stream } from "@garmin/fitsdk";
import { unzipSync } from "fflate";
import type { Lap } from "../training/compliance";
import type { Zone } from "../training/zones";

// Extracts laps, power and HR-zone time from an original activity file. Garmin delivers
// the file zipped; uploads from other sources may be raw .fit bytes.

export interface FitSummary {
  laps: Lap[];
  normalizedPowerW: number | null;
  avgPowerW: number | null;
  hrZoneSeconds: number[] | null;
  /** [epoch ms, bpm] per record, for laps rebuilt elsewhere (treadmill sessions) */
  hrSamples: [number, number][];
}

function fitBytes(file: Uint8Array): Uint8Array {
  const isZip = file[0] === 0x50 && file[1] === 0x4b;
  if (!isZip) return file;
  const entries = unzipSync(file);
  const name = Object.keys(entries).find((n) => n.toLowerCase().endsWith(".fit"));
  if (!name) throw new Error("No .fit file inside the Garmin download");
  return entries[name];
}

type Mesg = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseFit(file: Uint8Array, hrZones?: Zone[] | null): FitSummary {
  const decoder = new Decoder(Stream.fromByteArray(fitBytes(file)));
  const { messages } = decoder.read({ convertDateTimesToDates: true });
  const lapMesgs = (messages.lapMesgs ?? []) as Mesg[];
  const sessions = (messages.sessionMesgs ?? []) as Mesg[];
  const records = (messages.recordMesgs ?? []) as Mesg[];

  const laps: Lap[] = lapMesgs.map((l) => ({
    durationSec: Math.round(num(l.totalTimerTime) ?? num(l.totalElapsedTime) ?? 0),
    distanceM: Math.round(num(l.totalDistance) ?? 0),
    avgHr: num(l.avgHeartRate),
    avgPower: num(l.avgPower),
  }));

  const session = sessions[0] ?? {};
  let hrZoneSeconds: number[] | null = null;
  if (hrZones?.length && records.length > 1) {
    hrZoneSeconds = hrZones.map(() => 0);
    for (let i = 1; i < records.length; i++) {
      const hr = num(records[i].heartRate);
      const t1 = records[i].timestamp as Date | undefined;
      const t0 = records[i - 1].timestamp as Date | undefined;
      if (!hr || !t0 || !t1) continue;
      const dt = Math.min(10, (t1.getTime() - t0.getTime()) / 1000);
      if (dt <= 0) continue;
      let z = hrZones.findIndex((zone) => hr <= zone.high);
      if (z === -1) z = hrZones.length - 1;
      hrZoneSeconds[z] += dt;
    }
    hrZoneSeconds = hrZoneSeconds.map(Math.round);
  }

  const hrSamples: [number, number][] = [];
  for (const r of records) {
    const hr = num(r.heartRate);
    const t = r.timestamp as Date | undefined;
    if (hr && t) hrSamples.push([t.getTime(), hr]);
  }

  return {
    laps,
    normalizedPowerW: num(session.normalizedPower),
    avgPowerW: num(session.avgPower),
    hrZoneSeconds,
    hrSamples,
  };
}

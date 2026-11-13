import { describe, expect, it } from "vitest";
import { activeSec, avgPaceSecPerKm } from "./active-time";

describe("activeSec", () => {
  it("uses lap timer time over the watch's moving time", () => {
    // Treadmill: the watch counted only 40:00 as moving, the laps say 41:40.
    const a = { durationSec: 2600, movingSec: 2400, distanceM: 5540, laps: [{ durationSec: 1250, distanceM: 2770 }, { durationSec: 1250, distanceM: 2770 }] };
    expect(activeSec(a)).toBe(2500);
    expect(Math.round(avgPaceSecPerKm(a)!)).toBe(451); // 7:31, same as the laps
  });

  it("falls back to moving, then elapsed time without laps", () => {
    expect(activeSec({ durationSec: 2600, movingSec: 2400, laps: [] })).toBe(2400);
    expect(activeSec({ durationSec: 2600, movingSec: null, laps: [] })).toBe(2600);
  });
});

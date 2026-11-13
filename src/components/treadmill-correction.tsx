import { correctTreadmill, resetTreadmill } from "@/app/(app)/actions";
import type { Activity } from "@/db/schema";
import { averageIncline, formatKmh, treadmillCorrection } from "@/lib/training/treadmill";
import { formatDuration } from "@/lib/training/vdot";
import { SubmitButton } from "./submit-button";
import { Field, Section, inputClass } from "./ui";

const cellInput = "num w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-right text-base outline-none focus:border-ink";

function Buttons() {
  return (
    <div className="flex gap-2">
      <SubmitButton variant="quiet" pendingText="Saving…">
        Save
      </SubmitButton>
      <SubmitButton name="reanalyze" value="1" pendingText="Sending…">
        Save and re-analyse
      </SubmitButton>
    </div>
  );
}

/** Lets the athlete replace a treadmill run's watch-guessed distance with what the belt said. */
export function TreadmillCorrection({ activity: a }: { activity: Activity }) {
  const fix = treadmillCorrection(a.extra);
  const incline = averageIncline(a.laps);
  const km = (m: number | null) => (m ? (m / 1000).toFixed(2) : "");

  return (
    <Section title="Treadmill">
      {fix ? (
        <p className="text-[15px] text-muted">
          {fix.method === "session" ? "Distance, laps and incline from your live treadmill session in the app" : "Distance from the treadmill"}
          {fix.method === "laps" ? ", lap by lap" : ""}
          {incline != null ? `, ${incline}% incline on average` : ""}.
          {a.source !== "manual" && <> The watch had guessed {fix.originalDistanceM ? `${km(fix.originalDistanceM)} km` : "no distance"}.</>}
        </p>
      ) : (
        <p className="text-[15px] leading-relaxed">
          Your watch guesses treadmill distance from arm swing, so pace can be well off. Enter what the treadmill showed and
          pace, training load and plan match are worked out from that.
        </p>
      )}

      <form action={correctTreadmill} className="mt-4 space-y-3">
        <input type="hidden" name="id" value={a.id} />
        <input type="hidden" name="method" value="distance" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Distance on the treadmill, km">
            <input name="distanceKm" inputMode="decimal" required defaultValue={km(a.distanceM)} className={inputClass} />
          </Field>
          <Field label="Incline, %">
            <input name="incline" inputMode="decimal" placeholder="0" defaultValue={incline ?? ""} className={inputClass} />
          </Field>
        </div>
        <Buttons />
      </form>

      {a.laps.length > 1 && (
        <details className="mt-5" open={fix?.method === "laps"}>
          <summary className="cursor-pointer text-sm font-medium">Set speed and incline lap by lap</summary>
          <form action={correctTreadmill} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="method" value="laps" />
            <table className="w-full text-right">
              <thead className="text-sm text-muted">
                <tr>
                  <th className="py-1 text-left font-normal">Lap</th>
                  <th className="font-normal">Time</th>
                  <th className="w-24 font-normal">km/h</th>
                  <th className="w-24 font-normal">Incline %</th>
                </tr>
              </thead>
              <tbody className="num">
                {a.laps.map((l, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1.5 text-left">{i + 1}</td>
                    <td>{formatDuration(l.durationSec)}</td>
                    <td className="pl-2">
                      <input
                        name={`kmh_${i}`}
                        inputMode="decimal"
                        aria-label={`Lap ${i + 1} speed, km/h`}
                        defaultValue={l.distanceM && l.durationSec ? formatKmh(l.distanceM / 1000 / (l.durationSec / 3600)) : ""}
                        className={cellInput}
                      />
                    </td>
                    <td className="pl-2">
                      <input
                        name={`incline_${i}`}
                        inputMode="decimal"
                        aria-label={`Lap ${i + 1} incline, %`}
                        placeholder="0"
                        defaultValue={l.inclinePct ?? ""}
                        className={cellInput}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Buttons />
          </form>
        </details>
      )}

      {fix && a.source !== "manual" && (
        <form action={resetTreadmill} className="mt-5">
          <input type="hidden" name="id" value={a.id} />
          <SubmitButton variant="quiet" pendingText="Resetting…">
            Use the watch&apos;s numbers again
          </SubmitButton>
        </form>
      )}
    </Section>
  );
}

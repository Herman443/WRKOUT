import type { AthleteProfile } from "@/db/schema";
import { WEEKDAYS } from "@/lib/dates";
import { PR_DISTANCES } from "@/lib/forms";
import { formatDuration, formatPace } from "@/lib/training/vdot";
import { Field, inputClass } from "./ui";

const pace = (s: number | null | undefined) => (s ? formatPace(s) : "");

/** Fitness markers and weekly availability; shared by onboarding and settings. */
export function ProfileFields({ profile }: { profile: AthleteProfile | null }) {
  const a = profile?.availability;
  const days = new Set(a?.days ?? [0, 1, 3, 5, 6]);
  const pr = (label: string) => profile?.prs.find((p) => p.label === label);
  return (
    <>
      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold tracking-tight">Your week</legend>
        <div>
          <span className="text-sm text-muted">Days you can train</span>
          <div className="mt-2 grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className="relative">
                <input type="checkbox" name="days" value={i} defaultChecked={days.has(i)} className="peer sr-only" />
                <span className="block rounded-lg border border-line bg-paper py-2 text-center text-sm peer-checked:border-ink peer-checked:bg-ink peer-checked:text-fog peer-focus-visible:outline-2">
                  {d}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Long session day">
            <select name="longDay" defaultValue={a?.longDay ?? 6} className={inputClass}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hours per week">
            <input name="weeklyHours" inputMode="decimal" defaultValue={a?.weeklyHours ?? 5} className={inputClass} />
          </Field>
          <Field label="Running km per week" hint="What you run now">
            <input name="weeklyRunKm" inputMode="decimal" defaultValue={a?.weeklyRunKm ?? ""} className={inputClass} />
          </Field>
          <Field label="Cycling hours per week">
            <input name="weeklyBikeHours" inputMode="decimal" defaultValue={a?.weeklyBikeHours ?? ""} className={inputClass} />
          </Field>
          <Field label="Longest weekday session" hint="Minutes">
            <input name="maxWeekdayMinutes" inputMode="numeric" defaultValue={a?.maxWeekdayMinutes ?? ""} className={inputClass} />
          </Field>
          <Field label="Experience">
            <select name="experience" defaultValue={profile?.experience ?? "intermediate"} className={inputClass}>
              <option value="beginner">New to structured training</option>
              <option value="intermediate">A few seasons in</option>
              <option value="advanced">Experienced</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="strength" defaultChecked={a?.strength ?? true} className="h-5 w-5 accent-[var(--ink)]" />
          Include short strength sessions
        </label>
      </fieldset>

      <fieldset className="mt-9 space-y-4">
        <legend className="text-lg font-semibold tracking-tight">How fast you are</legend>
        <p className="text-sm text-muted">Recent best times set your paces. Leave blank what you don&apos;t know.</p>
        <div className="space-y-2">
          {PR_DISTANCES.map((d) => {
            const r = pr(d.label);
            return (
              <div key={d.key} className="grid grid-cols-[7.5rem_1fr_1fr] items-center gap-2">
                <span className="text-sm">{d.label}</span>
                <input
                  name={`pr_${d.key}`}
                  placeholder={d.distanceM > 20000 ? "h:mm:ss" : "mm:ss"}
                  defaultValue={r ? formatDuration(r.timeSec) : ""}
                  className={inputClass}
                  aria-label={`${d.label} time`}
                />
                <input
                  type="date"
                  name={`pr_${d.key}_date`}
                  defaultValue={r?.date ?? ""}
                  className={inputClass}
                  aria-label={`${d.label} date`}
                />
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Zone 2 pace" hint="min:sec per km">
            <input name="zone2Pace" placeholder="5:40" defaultValue={pace(profile?.zone2PaceSecPerKm)} className={inputClass} />
          </Field>
          <Field label="Threshold pace" hint="Optional override">
            <input name="thresholdPace" placeholder="4:30" defaultValue={pace(profile?.thresholdPaceSecPerKm)} className={inputClass} />
          </Field>
          <Field label="FTP" hint="Watts">
            <input name="ftp" inputMode="numeric" defaultValue={profile?.ftp ?? ""} className={inputClass} />
          </Field>
          <Field label="Max heart rate">
            <input name="maxHr" inputMode="numeric" defaultValue={profile?.maxHr ?? ""} className={inputClass} />
          </Field>
          <Field label="Resting heart rate">
            <input name="restingHr" inputMode="numeric" defaultValue={profile?.restingHr ?? ""} className={inputClass} />
          </Field>
          <Field label="Threshold HR, run">
            <input name="lthrRun" inputMode="numeric" defaultValue={profile?.lthrRun ?? ""} className={inputClass} />
          </Field>
          <Field label="Threshold HR, bike">
            <input name="lthrBike" inputMode="numeric" defaultValue={profile?.lthrBike ?? ""} className={inputClass} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="mt-9 space-y-4">
        <legend className="text-lg font-semibold tracking-tight">About you</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input name="name" defaultValue={profile?.name ?? ""} className={inputClass} />
          </Field>
          <Field label="Sex">
            <select name="sex" defaultValue={profile?.sex ?? ""} className={inputClass}>
              <option value="">Prefer not to say</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </Field>
          <Field label="Birth year">
            <input name="birthYear" inputMode="numeric" defaultValue={profile?.birthYear ?? ""} className={inputClass} />
          </Field>
          <Field label="Weight" hint="kg">
            <input name="weightKg" inputMode="decimal" defaultValue={profile?.weightKg ?? ""} className={inputClass} />
          </Field>
        </div>
        <Field label="Anything your coach should know" hint="Injuries, travel, terrain, preferences">
          <textarea name="notes" rows={3} defaultValue={profile?.notes ?? ""} className={inputClass} />
        </Field>
      </fieldset>
    </>
  );
}

import "server-only";
import { asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { activities, coachMessages, dailyHealth, planChanges } from "@/db/schema";
import { deriveMarkers } from "../athlete";
import { addDays, diffDays, formatDay, startOfWeek, todayLocal, weekday, WEEKDAYS } from "../dates";
import { getActivePlan, getProfile, getWeeks, workoutsBetween } from "../plan-store";
import { getKv } from "../ingest";
import { acwr, fitnessSeries } from "../training/load";
import { isTreadmill, paceTrusted, type RunSurface } from "../training/treadmill";
import { formatDuration, formatPace } from "../training/vdot";
import type { Zone } from "../training/zones";

const km = (m: number | null | undefined) => (m ? `${(m / 1000).toFixed(1)} km` : "");
const zoneLine = (zones: Zone[] | null, unit: (n: number) => string) =>
  zones?.map((z) => `${z.name} ${unit(z.low)}–${unit(z.high)}`).join(", ") ?? "unknown";

export async function fitnessToday() {
  const today = todayLocal();
  const from = addDays(today, -120);
  const rows = await db
    .select({ date: activities.localDate, load: activities.load })
    .from(activities)
    .where(gte(activities.localDate, from));
  const loads = rows.map((r) => ({ date: r.date, load: r.load ?? 0 }));
  const series = fitnessSeries(loads, from, today);
  const last = series.at(-1)!;
  return { ctl: last.ctl, atl: last.atl, tsb: last.tsb, acwr: acwr(loads, today), series };
}

/** Plain-text snapshot of everything the coach needs to know right now. */
export async function buildContext(opts: { upcomingDays?: number } = {}): Promise<string> {
  const today = todayLocal();
  const profile = await getProfile();
  const m = deriveMarkers(profile);
  const active = await getActivePlan();
  const out: string[] = [];

  out.push(`Today is ${formatDay(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${today}).`);

  out.push("\n## Athlete");
  if (profile) {
    const age = profile.birthYear ? new Date().getFullYear() - profile.birthYear : null;
    out.push(
      [profile.name, profile.sex, age && `${age} y`, profile.weightKg && `${profile.weightKg} kg`, `${profile.experience} level`]
        .filter(Boolean)
        .join(", "),
    );
    if (profile.prs.length)
      out.push(`Results: ${profile.prs.map((r) => `${r.label} ${formatDuration(r.timeSec)}${r.date ? ` (${r.date})` : ""}`).join("; ")}`);
    out.push(
      `Markers: VDOT ${m.vdot ? m.vdot.toFixed(1) : "unknown"}${m.vdotSource ? ` (from ${m.vdotSource})` : ""}, max HR ${profile.maxHr ?? "?"}, resting HR ${profile.restingHr ?? "?"}, run LTHR ${profile.lthrRun ?? "?"}, bike LTHR ${profile.lthrBike ?? "?"}, FTP ${profile.ftp ? `${profile.ftp} W` : "?"}, zone 2 pace ${profile.zone2PaceSecPerKm ? `${formatPace(profile.zone2PaceSecPerKm)}/km` : "?"}`,
    );
    const p = m.zones.runPaces;
    if (p)
      out.push(
        `Run paces (sec/km): Easy ${Math.round(p.easy[0])}–${Math.round(p.easy[1])} (${formatPace(p.easy[0])}–${formatPace(p.easy[1])}/km), Marathon ${Math.round(p.marathon)} (${formatPace(p.marathon)}), Threshold ${Math.round(p.threshold)} (${formatPace(p.threshold)}), Interval ${Math.round(p.interval)} (${formatPace(p.interval)}), Repetition ${Math.round(p.repetition)} (${formatPace(p.repetition)})`,
      );
    out.push(`Run HR zones: ${zoneLine(m.zones.runHr, (n) => `${n}`)}`);
    out.push(`Bike HR zones: ${zoneLine(m.zones.bikeHr, (n) => `${n}`)}`);
    if (m.zones.bikePower) out.push(`Power zones (W): ${zoneLine(m.zones.bikePower, (n) => `${n}`)}`);
    const a = profile.availability;
    if (a)
      out.push(
        `Availability: ${a.days.map((d) => WEEKDAYS[d]).join(", ")}; long day ${WEEKDAYS[a.longDay]}; about ${a.weeklyHours} h/week` +
          (a.weeklyRunKm ? `, ~${a.weeklyRunKm} km running` : "") +
          (a.weeklyBikeHours ? `, ~${a.weeklyBikeHours} h cycling` : "") +
          (a.maxWeekdayMinutes ? `; weekday sessions up to ${a.maxWeekdayMinutes} min` : "") +
          `; strength ${a.strength ? "wanted" : "not wanted"}`,
      );
    if ((await getKv<RunSurface>("run_surface")) === "treadmill")
      out.push(
        "Runs mostly on a treadmill: the app shows pace targets as belt speed. Prefer steps with steady, time- or distance-based targets that are easy to set on a belt, and write hill work as incline (%).",
      );
    if (profile.notes) out.push(`Athlete notes: ${profile.notes}`);
  } else {
    out.push("No profile yet.");
  }

  if (active) {
    const { goal, plan } = active;
    out.push("\n## Goal");
    out.push(
      `${goal.name}: ${goal.sport}${goal.distanceM ? `, ${km(goal.distanceM)}` : ""} on ${goal.eventDate} (${Math.ceil(diffDays(today, goal.eventDate) / 7)} weeks away)` +
        (goal.targetTimeSec ? `, target ${formatDuration(goal.targetTimeSec)}` : ""),
    );
    if (goal.notes) out.push(`Goal notes: ${goal.notes}`);

    const weeks = await getWeeks(plan.id);
    if (weeks.length) {
      out.push("\n## Plan");
      if (plan.summary) out.push(plan.summary);
      const current = weeks.find((w) => w.startDate === startOfWeek(today));
      const upcoming = weeks.filter((w) => w.startDate >= startOfWeek(addDays(today, -7))).slice(0, 6);
      for (const w of upcoming) {
        out.push(
          `- Week ${w.index} from ${w.startDate}${w === current ? " (this week)" : ""}: ${w.phase}${w.isDeload ? ", deload" : ""}, ${w.targetHours} h` +
            (w.targetRunKm ? `, ${w.targetRunKm} km run` : "") +
            `. ${w.focus}`,
        );
      }
    }

    const horizon = addDays(today, opts.upcomingDays ?? 14);
    const workouts = await workoutsBetween(plan.id, addDays(today, -14), horizon);
    if (workouts.length) {
      out.push("\n## Planned workouts (past 14 days and upcoming), with ids");
      for (const w of workouts) {
        out.push(
          `- [${w.id}] ${w.date} ${WEEKDAYS[weekday(w.date)]} ${w.sport}/${w.type}${w.key ? " KEY" : ""}: "${w.title}", ` +
            `${w.plannedDurationSec ? formatDuration(w.plannedDurationSec) : "?"}${w.plannedDistanceM ? `, ${km(w.plannedDistanceM)}` : ""} — ${w.status}`,
        );
      }
    }
  }

  const recent = await db
    .select()
    .from(activities)
    .where(gte(activities.localDate, addDays(today, -28)))
    .orderBy(asc(activities.startTime));
  if (recent.length) {
    out.push("\n## Completed activities (last 28 days)");
    for (const a of recent) {
      const belt = isTreadmill(a.subSport) ? (paceTrusted(a) ? " (treadmill)" : " (treadmill, distance is the watch's guess)") : "";
      out.push(
        `- ${a.localDate} ${a.sport}${belt} "${a.name}": ${formatDuration(a.durationSec)}${a.distanceM ? `, ${km(a.distanceM)}` : ""}` +
          (a.avgHr ? `, avg HR ${a.avgHr}` : "") +
          (a.normalizedPowerW ? `, NP ${a.normalizedPowerW} W` : "") +
          (a.load ? `, load ${Math.round(a.load)}` : "") +
          (a.compliance ? `, plan match ${a.compliance.score}` : "") +
          (a.rpe ? `, RPE ${a.rpe}` : "") +
          (a.notes ? `, note: ${a.notes}` : ""),
      );
    }
  }

  const f = await fitnessToday();
  out.push("\n## Fitness and readiness");
  out.push(`Fitness (CTL) ${f.ctl}, fatigue (ATL) ${f.atl}, form (TSB) ${f.tsb}, acute:chronic ratio ${f.acwr ?? "n/a"}`);
  const health = await db
    .select()
    .from(dailyHealth)
    .where(gte(dailyHealth.date, addDays(today, -7)))
    .orderBy(asc(dailyHealth.date));
  for (const h of health) {
    out.push(
      `- ${h.date}: ` +
        [
          h.sleepSec && `sleep ${formatDuration(h.sleepSec).replace(/:\d\d$/, "")} h`,
          h.sleepScore && `sleep score ${h.sleepScore}`,
          h.hrvMs && `HRV ${Math.round(h.hrvMs)} ms${h.hrvStatus ? ` (${h.hrvStatus.toLowerCase()})` : ""}`,
          h.restingHr && `resting HR ${h.restingHr}`,
          h.bodyBattery && `body battery ${h.bodyBattery}`,
          h.stress && `stress ${h.stress}`,
        ]
          .filter(Boolean)
          .join(", "),
    );
  }

  const messages = await db.select().from(coachMessages).orderBy(desc(coachMessages.createdAt)).limit(8);
  if (messages.length) {
    out.push("\n## Recent conversation");
    for (const msg of messages.reverse()) out.push(`${msg.role === "user" ? "Athlete" : "Coach"}: ${msg.content}`);
  }

  const pending = await db.select().from(planChanges).where(eq(planChanges.status, "pending"));
  if (pending.length) {
    out.push("\n## Pending proposals awaiting the athlete");
    for (const p of pending) out.push(`- ${p.rationale}`);
  }

  return out.join("\n");
}

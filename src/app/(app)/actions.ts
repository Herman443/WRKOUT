"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import {
  activities,
  athleteProfile,
  coachMessages,
  goals,
  kv,
  plannedWorkouts,
  plans,
  pushSubscriptions,
  type Availability,
  type PersonalRecord,
} from "@/db/schema";
import type { MarkerUpdate } from "@/lib/ai/review";
import { requireSession } from "@/lib/auth";
import { addDays, startOfWeek, todayLocal, weekday } from "@/lib/dates";
import { PR_DISTANCES } from "@/lib/forms";
import { getKv, pollGarmin } from "@/lib/ingest";
import { enqueue, kickWorker } from "@/lib/jobs";
import { decideChange, getActivePlan } from "@/lib/plan-store";
import { sendPush } from "@/lib/push";
import { disconnectStravaMcp } from "@/lib/strava/mcp-auth";

// ---------- parsing ----------

/** "1:23:45", "23:45" or "45" (minutes) → seconds */
function parseTime(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 1) return Math.round(parts[0] * 60);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/** "5:20" per km → seconds */
function parsePace(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const [m, sec = "0"] = s.split(":");
  const total = Number(m) * 60 + Number(sec);
  return Number.isFinite(total) && total > 0 ? total : null;
}

function int(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? "").trim());
  return String(v ?? "").trim() && Number.isFinite(n) ? Math.round(n) : null;
}

function float(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? "").trim().replace(",", "."));
  return String(v ?? "").trim() && Number.isFinite(n) ? n : null;
}

// ---------- profile & goal ----------

function profileFromForm(form: FormData) {
  const days = form.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6);
  const availability: Availability = {
    days: days.length ? days : [0, 1, 3, 5, 6],
    longDay: int(form.get("longDay")) ?? 6,
    weeklyHours: float(form.get("weeklyHours")) ?? 5,
    weeklyRunKm: float(form.get("weeklyRunKm")),
    weeklyBikeHours: float(form.get("weeklyBikeHours")),
    maxWeekdayMinutes: int(form.get("maxWeekdayMinutes")),
    strength: form.get("strength") === "on",
  };
  const prs: PersonalRecord[] = PR_DISTANCES.flatMap((d) => {
    const timeSec = parseTime(form.get(`pr_${d.key}`));
    if (!timeSec) return [];
    const date = String(form.get(`pr_${d.key}_date`) ?? "") || null;
    return [{ label: d.label, sport: "run" as const, distanceM: d.distanceM, timeSec, date }];
  });
  return {
    name: String(form.get("name") ?? "").trim() || null,
    sex: String(form.get("sex") ?? "") || null,
    birthYear: int(form.get("birthYear")),
    weightKg: float(form.get("weightKg")),
    experience: String(form.get("experience") ?? "intermediate"),
    maxHr: int(form.get("maxHr")),
    restingHr: int(form.get("restingHr")),
    lthrRun: int(form.get("lthrRun")),
    lthrBike: int(form.get("lthrBike")),
    ftp: int(form.get("ftp")),
    zone2PaceSecPerKm: parsePace(form.get("zone2Pace")),
    thresholdPaceSecPerKm: parsePace(form.get("thresholdPace")),
    prs,
    availability,
    notes: String(form.get("notes") ?? "").trim() || null,
  };
}

async function upsertProfile(form: FormData) {
  const values = profileFromForm(form);
  await db
    .insert(athleteProfile)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: athleteProfile.id, set: values });
}

export async function saveProfile(form: FormData) {
  await requireSession();
  await upsertProfile(form);
  revalidatePath("/", "layout");
  redirect("/settings?saved=profile");
}

export async function startPlan(form: FormData) {
  await requireSession();
  await upsertProfile(form);

  const today = todayLocal();
  const eventDate = String(form.get("eventDate") ?? "");
  const distanceChoice = String(form.get("distance") ?? "");
  const distanceM =
    distanceChoice === "custom" ? Math.round((float(form.get("customKm")) ?? 0) * 1000) || null : int(distanceChoice);
  const sport = String(form.get("sport") ?? "run") as "run" | "bike";
  const name = String(form.get("goalName") ?? "").trim() || (sport === "run" ? "Goal race" : "Goal event");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || eventDate < addDays(today, 7)) {
    redirect("/onboarding?error=date");
  }

  const startDate = weekday(today) <= 2 ? startOfWeek(today) : addDays(startOfWeek(today), 7);
  const planId = await db.transaction(async (tx) => {
    await tx.update(plans).set({ status: "archived" }).where(inArray(plans.status, ["active", "generating", "failed"]));
    await tx.update(goals).set({ status: "archived" }).where(eq(goals.status, "active"));
    const [goal] = await tx
      .insert(goals)
      .values({
        sport,
        name,
        eventDate,
        distanceM,
        targetTimeSec: parseTime(form.get("targetTime")),
        notes: String(form.get("goalNotes") ?? "").trim() || null,
      })
      .returning();
    const [plan] = await tx
      .insert(plans)
      .values({ goalId: goal.id, startDate: startDate > eventDate ? startOfWeek(eventDate) : startDate, endDate: eventDate })
      .returning();
    return plan.id;
  });

  await enqueue("macro_plan", { planId });
  after(kickWorker);
  redirect("/plan");
}

export async function retryPlan() {
  await requireSession();
  const active = await db.select().from(plans).where(inArray(plans.status, ["failed", "generating"]));
  const plan = active.at(-1);
  if (!plan) return;
  await db.update(plans).set({ status: "generating", error: null }).where(eq(plans.id, plan.id));
  await enqueue("macro_plan", { planId: plan.id });
  after(kickWorker);
  refresh();
}

// ---------- coach ----------

export async function sendCoachNote(form: FormData) {
  await requireSession();
  const text = String(form.get("text") ?? "").trim();
  if (!text) return;
  await db.insert(coachMessages).values({ role: "user", content: text.slice(0, 2000) });
  await enqueue("coach_note", { text: text.slice(0, 2000), trigger: "coach_note" });
  after(kickWorker);
  refresh();
}

export async function decideProposal(form: FormData) {
  await requireSession();
  await decideChange(String(form.get("id")), form.get("decision") === "approve");
  revalidatePath("/", "layout");
}

export async function applyMarkerUpdates(form: FormData) {
  await requireSession();
  const updates = (await getKv<MarkerUpdate[]>("pending_marker_updates")) ?? [];
  const chosen = new Set(form.getAll("marker").map(String));
  const patch: Record<string, number> = {};
  for (const u of updates) if (chosen.has(u.marker)) patch[u.marker] = u.value;
  if (Object.keys(patch).length) await db.update(athleteProfile).set(patch).where(eq(athleteProfile.id, 1));
  await db.delete(kv).where(eq(kv.key, "pending_marker_updates"));
  revalidatePath("/", "layout");
}

// ---------- workouts & activities ----------

export async function setWorkoutStatus(form: FormData) {
  await requireSession();
  const id = String(form.get("id"));
  const status = form.get("status") === "skipped" ? "skipped" : "planned";
  await db
    .update(plannedWorkouts)
    .set({ status })
    .where(and(eq(plannedWorkouts.id, id), inArray(plannedWorkouts.status, ["planned", "skipped", "missed"])));
  revalidatePath("/", "layout");
}

export async function moveWorkout(form: FormData) {
  await requireSession();
  const id = String(form.get("id"));
  const date = String(form.get("date"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayLocal()) return;
  await db.update(plannedWorkouts).set({ date, status: "planned", source: "user" }).where(eq(plannedWorkouts.id, id));
  revalidatePath("/", "layout");
}

export async function saveFeedback(form: FormData) {
  await requireSession();
  const id = String(form.get("id"));
  const rpe = int(form.get("rpe"));
  await db
    .update(activities)
    .set({
      rpe: rpe && rpe >= 1 && rpe <= 10 ? rpe : null,
      feel: String(form.get("feel") ?? "") || null,
      notes: String(form.get("notes") ?? "").trim().slice(0, 1000) || null,
    })
    .where(eq(activities.id, id));
  if (form.get("reanalyze") === "1") {
    await db.update(activities).set({ analysisStatus: "pending" }).where(eq(activities.id, id));
    await enqueue("analyze_activity", { activityId: id });
    after(kickWorker);
  }
  revalidatePath(`/activities/${id}`);
}

export async function disconnectStrava() {
  await requireSession();
  await disconnectStravaMcp();
  revalidatePath("/settings");
}

export async function syncNow() {
  await requireSession();
  const added = await pollGarmin();
  if (added.length) after(kickWorker);
  redirect(`/settings?synced=${added.length}`);
}

// ---------- notifications ----------

export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  await requireSession();
  const values = { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth };
  await db.insert(pushSubscriptions).values(values).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
}

export async function removePushSubscription(endpoint: string) {
  await requireSession();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function sendTestPush() {
  await requireSession();
  const active = await getActivePlan();
  const sent = await sendPush({
    title: "Notifications are on",
    body: active ? `You'll hear from your coach about ${active.goal.name}.` : "You'll get workout analyses and plan updates here.",
    url: "/",
    tag: "test",
  });
  return sent;
}

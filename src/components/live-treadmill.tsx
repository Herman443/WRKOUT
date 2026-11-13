"use client";

import { ChevronLeft, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { finishTreadmillSession } from "@/app/(app)/actions";
import { LEVEL_COLOR } from "@/lib/training/intensity";
import { formatKmh } from "@/lib/training/treadmill";
import {
  LIVE_STORAGE_KEY,
  advanceIfDue,
  hasStarted,
  newLive,
  nextLap,
  pause,
  plannedKmh,
  segmentsAt,
  setBelt,
  start,
  stepRemaining,
  totals,
  type LiveState,
  type LiveStep,
} from "@/lib/training/treadmill-live";
import { formatDuration, formatPace } from "@/lib/training/vdot";

// The live treadmill screen. The session is kept in localStorage on every change, so a
// locked screen, a reload or leaving the page never loses it; it reaches the server only
// when it is finished.

/** Only ever called from taps and timers (the compiler can't tell for custom button props). */
const clock = () => Date.now();

const subscribeNothing = () => () => {};
/** True once hydrated: the session lives in localStorage, which the server cannot see. */
export const useIsClient = () =>
  useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

export function readLiveSession(): LiveState | null {
  try {
    const s = JSON.parse(localStorage.getItem(LIVE_STORAGE_KEY) ?? "null") as LiveState | null;
    return s?.v === 1 && s.id ? s : null;
  } catch {
    return null;
  }
}

export const liveSessionHref = (s: Pick<LiveState, "workoutId">) => (s.workoutId ? `/treadmill?workout=${s.workoutId}` : "/treadmill");

interface Props {
  workoutId: string | null;
  title: string;
  steps: LiveStep[];
  /** Belt speed to start an unplanned run at */
  startKmh: number;
  backHref: string;
}

export function LiveTreadmill(props: Props) {
  const isClient = useIsClient();
  return <div className="fixed inset-0 z-30 overflow-y-auto bg-fog">{isClient && <Session {...props} />}</div>;
}

const fmtStepDuration = (s: LiveStep) =>
  s.duration.type === "time" && s.duration.value
    ? formatDuration(s.duration.value)
    : s.duration.type === "distance" && s.duration.value
      ? s.duration.value >= 1000
        ? `${+(s.duration.value / 1000).toFixed(2)} km`
        : `${s.duration.value} m`
      : "open";

function Session({ workoutId, title, steps, startKmh, backHref }: Props) {
  const router = useRouter();
  const [stored] = useState(readLiveSession);
  const [otherDismissed, setOtherDismissed] = useState(false);
  const other = stored && hasStarted(stored) && stored.workoutId !== workoutId && !otherDismissed ? stored : null;
  const [live, setLive] = useState<LiveState>(() =>
    stored && stored.workoutId === workoutId ? stored : newLive(workoutId, title, plannedKmh(steps[0]) ?? startKmh),
  );
  const [now, setNow] = useState(() => Date.now());
  const [finishing, setFinishing] = useState(false);
  const [onWatch, setOnWatch] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const liveRef = useRef(live);
  const audio = useRef<AudioContext | null>(null);
  const lastCue = useRef("");

  useEffect(() => {
    liveRef.current = live;
    if (!saved && hasStarted(live)) localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(live));
  }, [live, saved]);

  // Beeps: three short ones before a timed step ends, a long one when the next step starts.
  function beep(freq: number, ms: number) {
    const ctx = audio.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.25;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
    navigator.vibrate?.(ms);
  }

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      const cur = liveRef.current;
      const next = advanceIfDue(cur, t, steps);
      if (next !== cur) {
        liveRef.current = next;
        setLive(next);
        beep(1046, 450);
      } else if (cur.open) {
        const lap = totals(segmentsAt(cur, t), cur.lap);
        const left = stepRemaining(steps[cur.lap], lap.sec, lap.m);
        const sec = left?.unit === "sec" ? Math.ceil(left.value) : null;
        const key = `${cur.lap}:${sec}`;
        if (sec !== null && sec >= 1 && sec <= 3 && lastCue.current !== key) {
          lastCue.current = key;
          beep(784, 120);
        }
      }
      setNow(t);
    }, 250);
    return () => clearInterval(id);
  }, [steps]);

  // Keep the screen on while running.
  const running = live.open !== null;
  useEffect(() => {
    if (!running || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request("screen");
        if (cancelled) l.release();
        else lock = l;
      } catch {
        // Not allowed right now (e.g. low battery); the session keeps running anyway.
      }
    };
    acquire();
    const onVisible = () => document.visibilityState === "visible" && acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release();
    };
  }, [running]);

  const act = (fn: (s: LiveState, t: number) => LiveState) => {
    const t = clock();
    const next = fn(liveRef.current, t);
    liveRef.current = next;
    setLive(next);
    setNow(t);
  };

  function toggleRun() {
    // Audio can only be started from a tap on iOS.
    audio.current ??= new AudioContext();
    void audio.current.resume();
    act((s, t) => (s.open ? pause(s, t) : start(s, t)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const final = pause(liveRef.current, Date.now());
    liveRef.current = final;
    setLive(final);
    try {
      const { activityId } = await finishTreadmillSession({
        id: final.id,
        plannedWorkoutId: final.workoutId,
        recordedOnWatch: onWatch,
        segments: final.segments,
      });
      localStorage.removeItem(LIVE_STORAGE_KEY);
      setSaved(true);
      if (activityId) router.push(`/activities/${activityId}`);
    } catch {
      setError("Could not save. Check the connection and try again; the session is kept on this phone.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!confirm("Throw this treadmill session away?")) return;
    localStorage.removeItem(LIVE_STORAGE_KEY);
    setSaved(true);
    router.push(backHref);
  }

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-lg pt-[calc(1rem+env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[calc(9rem+env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))]">
      {children}
    </div>
  );

  if (other)
    return shell(
      <>
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">A treadmill session is still going</h1>
        <p className="mt-2 text-muted">
          {other.title}, {formatDuration(totals(segmentsAt(other, now)).sec)} so far. Finish or discard it before starting another.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={liveSessionHref(other)} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-fog">
            Back to it
          </Link>
          <button
            type="button"
            className="rounded-xl border border-z5/40 px-4 py-2.5 text-sm font-medium text-z5"
            onClick={() => {
              if (!confirm(`Throw away "${other.title}"?`)) return;
              localStorage.removeItem(LIVE_STORAGE_KEY);
              setOtherDismissed(true);
            }}
          >
            Discard it
          </button>
        </div>
      </>,
    );

  if (saved)
    return shell(
      <>
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Session saved</h1>
        <p className="mt-2 max-w-prose text-muted">
          When the run from your watch reaches Garmin, its distance, laps and incline are set from this session and your coach
          looks at it. If it has not arrived within three hours, the session is logged on its own.
        </p>
        <Link href={backHref} className="mt-6 inline-block rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-fog">
          Done
        </Link>
      </>,
    );

  const segs = segmentsAt(live, now);
  const all = totals(segs);
  const lap = totals(segs, live.lap);
  const step = steps[live.lap];
  const next = steps[live.lap + 1];
  const left = stepRemaining(step, lap.sec, lap.m);
  const planned = plannedKmh(step);
  const started = hasStarted(live);
  const isPlanned = steps.length > 0;
  const stepShare = left && step?.duration.value ? Math.min(1, Math.max(0, 1 - left.value / step.duration.value)) : null;

  return shell(
    <>
      <Link href={backHref} className="-ml-1 inline-flex items-center gap-0.5 text-sm text-muted">
        <ChevronLeft size={18} aria-hidden /> {started ? "Leave (keeps running)" : "Back"}
      </Link>
      <p className="mt-3 text-sm text-muted">Treadmill{isPlanned ? "" : ", no plan"}</p>
      <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-tight">{title}</h1>

      {isPlanned && (
        <section className="mt-5 rounded-2xl bg-paper p-4" aria-live="polite">
          {step ? (
            <>
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className={`h-2.5 w-2.5 rounded-full ${LEVEL_COLOR[step.level ?? 1]}`} aria-hidden />
                Step {live.lap + 1} of {steps.length}
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="text-xl font-semibold">{step.label}</span>
                {step.target && <span className="num shrink-0 text-right">{step.target}</span>}
              </div>
              <div className="num mt-3 text-5xl leading-none">
                {left
                  ? left.unit === "sec"
                    ? formatDuration(Math.max(0, Math.ceil(left.value)))
                    : `${Math.max(0, Math.round(left.value))} m`
                  : formatDuration(lap.sec)}
              </div>
              <div className="mt-1 text-sm text-muted">{left ? "left of this step" : "Open step: tap Next step when you are done"}</div>
              {stepShare !== null && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className={`h-full ${LEVEL_COLOR[step.level ?? 1]}`} style={{ width: `${stepShare * 100}%` }} />
                </div>
              )}
              {step.note && <p className="mt-3 text-sm text-muted">{step.note}</p>}
              {next && (
                <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
                  Next: <span className="text-ink">{next.label}</span>, {fmtStepDuration(next)}
                  {plannedKmh(next) != null ? ` at ${formatKmh(plannedKmh(next)!)} km/h` : next.target ? `, ${next.target}` : ""}
                </p>
              )}
            </>
          ) : (
            <p className="text-lg font-medium">That was the last step. Keep going, or finish when you are done.</p>
          )}
        </section>
      )}

      <section className="mt-7">
        <div className="flex items-baseline justify-between text-sm text-muted">
          <span>Speed</span>
          {planned != null && planned !== live.kmh && (
            <button type="button" className="underline decoration-line underline-offset-4" onClick={() => act((s, t) => setBelt(s, t, { kmh: planned }))}>
              Plan {formatKmh(planned)}, reset
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Nudge label="−0.5" onClick={() => act((s, t) => setBelt(s, t, { kmh: s.kmh - 0.5 }))} />
          <Round label="Slower" onClick={() => act((s, t) => setBelt(s, t, { kmh: s.kmh - 0.1 }))}>
            <Minus size={26} aria-hidden />
          </Round>
          <div className="min-w-0 flex-1 text-center">
            <div className="num text-6xl leading-none">{formatKmh(live.kmh)}</div>
            <div className="mt-1 text-sm text-muted">
              km/h, <span className="num">{live.kmh > 0 ? formatPace(3600 / live.kmh) : "–"}</span> /km
            </div>
          </div>
          <Round label="Faster" onClick={() => act((s, t) => setBelt(s, t, { kmh: s.kmh + 0.1 }))}>
            <Plus size={26} aria-hidden />
          </Round>
          <Nudge label="+0.5" onClick={() => act((s, t) => setBelt(s, t, { kmh: s.kmh + 0.5 }))} />
        </div>
      </section>

      <section className="mt-6">
        <div className="text-sm text-muted">Incline</div>
        <div className="mt-2 flex items-center gap-2">
          <Round label="Lower incline" onClick={() => act((s, t) => setBelt(s, t, { inclinePct: s.inclinePct - 0.5 }))}>
            <Minus size={22} aria-hidden />
          </Round>
          <div className="flex-1 text-center">
            <span className="num text-4xl">{live.inclinePct.toFixed(1)}</span>
            <span className="ml-0.5 text-muted">%</span>
          </div>
          <Round label="Higher incline" onClick={() => act((s, t) => setBelt(s, t, { inclinePct: s.inclinePct + 0.5 }))}>
            <Plus size={22} aria-hidden />
          </Round>
        </div>
      </section>

      <div className="mt-8 grid grid-cols-3 gap-3 border-t border-line pt-5">
        <Figure value={formatDuration(all.sec)} label="Time" />
        <Figure value={(all.m / 1000).toFixed(2)} unit="km" label="Distance" />
        <Figure value={all.m > 0 ? formatPace(all.sec / (all.m / 1000)) : "–"} unit="/km" label="Avg pace" />
        {!isPlanned && <Figure value={formatDuration(lap.sec)} label={`Lap ${live.lap + 1}`} />}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-fog/95 pt-3 pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2">
          <button type="button" onClick={toggleRun} className="flex-1 rounded-xl bg-ink px-4 py-3.5 text-base font-semibold text-fog">
            {running ? "Pause" : started ? "Resume" : "Start"}
          </button>
          <button
            type="button"
            onClick={() => act((s, t) => nextLap(s, t, steps))}
            className="rounded-xl border border-line bg-paper px-4 py-3.5 text-base font-medium text-ink"
          >
            {step ? "Next step" : "Lap"}
          </button>
          {started && (
            <button
              type="button"
              onClick={() => {
                act(pause);
                setFinishing(true);
              }}
              className="rounded-xl border border-line bg-paper px-4 py-3.5 text-base font-medium text-ink"
            >
              Finish
            </button>
          )}
        </div>
      </div>

      {finishing && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/50" role="dialog" aria-modal aria-labelledby="finish-title">
          <div className="mx-auto w-full max-w-lg rounded-t-2xl bg-fog p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <h2 id="finish-title" className="text-xl font-semibold">
              Finish the session?
            </h2>
            <p className="num mt-1 text-muted">
              {formatDuration(all.sec)}, {(all.m / 1000).toFixed(2)} km
            </p>
            <label className="mt-4 flex items-start gap-3">
              <input type="checkbox" checked={onWatch} onChange={(e) => setOnWatch(e.target.checked)} className="mt-1 h-5 w-5 accent-current" />
              <span>
                I recorded it on my watch too
                <span className="block text-sm text-muted">
                  {onWatch
                    ? "The watch's run gets its distance, laps and incline from this session when it syncs; heart rate comes from the watch."
                    : "The session is logged as an activity of its own, without heart rate."}
                </span>
              </span>
            </label>
            {error && <p className="mt-3 text-sm text-warn">{error}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" disabled={saving} onClick={save} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-fog disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setFinishing(false)}
                className="rounded-xl border border-line bg-paper px-4 py-2.5 text-sm font-medium text-ink"
              >
                Keep going
              </button>
              <button type="button" disabled={saving} onClick={discard} className="ml-auto px-2 py-2.5 text-sm font-medium text-z5">
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
  );
}

function Round({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-line bg-paper text-ink active:bg-line"
    >
      {children}
    </button>
  );
}

function Nudge({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="num h-10 w-11 shrink-0 rounded-lg text-sm text-muted active:bg-line">
      {label}
    </button>
  );
}

function Figure({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="num text-2xl leading-none">
        {value}
        {unit && <span className="ml-0.5 text-sm font-medium text-muted">{unit}</span>}
      </div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  );
}

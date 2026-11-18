"use client";

import { useSyncExternalStore } from "react";
import { LIVE_STORAGE_KEY, type LiveState } from "@/lib/training/treadmill-live";

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


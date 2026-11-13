"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasStarted } from "@/lib/training/treadmill-live";
import { liveSessionHref, readLiveSession, useIsClient } from "./live-treadmill";

/** A way back to a treadmill session left running on this phone. */
export function TreadmillResume() {
  const pathname = usePathname();
  const isClient = useIsClient();
  if (!isClient || pathname.startsWith("/treadmill")) return null;
  const live = readLiveSession();
  if (!live || !hasStarted(live)) return null;
  return (
    <Link
      href={liveSessionHref(live)}
      className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 mx-auto block max-w-lg px-[max(1.25rem,env(safe-area-inset-left))]"
    >
      <span className="flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-fog">
        <span className="min-w-0 truncate">
          Treadmill: {live.title}
          {live.open ? "" : ", paused"}
        </span>
        <span className="shrink-0 font-medium">Back to it</span>
      </span>
    </Link>
  );
}

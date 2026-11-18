"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the current route on an interval while background work is running. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    };
    const id = setInterval(refresh, seconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [router, seconds]);
  return null;
}

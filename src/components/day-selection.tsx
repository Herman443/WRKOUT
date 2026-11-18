"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

/** The week is already loaded; selecting a day only changes the visible content. */
export function DaySelection({ days, children }: { days: Record<string, ReactNode>; children: ReactNode }) {
  const day = useSearchParams().get("day");
  return <>{day && Object.hasOwn(days, day) ? days[day] : children}</>;
}

export function DayLink({ date, selectedDate, dates, children, ...props }: {
  date: string;
  selectedDate: string;
  dates: string[];
  children: ReactNode;
  className: string;
  "aria-label": string;
}) {
  const day = useSearchParams().get("day");
  const selected = day && dates.includes(day) ? day : selectedDate;
  return (
    <Link
      {...props}
      href={`/?day=${date}`}
      scroll={false}
      prefetch={false}
      aria-current={date === selected ? "true" : undefined}
      onNavigate={(event) => {
        event.preventDefault();
        window.history.pushState(null, "", `/?day=${date}`);
      }}
    >
      {children}
    </Link>
  );
}

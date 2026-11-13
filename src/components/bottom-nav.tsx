"use client";

import { CalendarDays, MessageCircle, SlidersHorizontal, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today", icon: Sun },
  { href: "/plan", label: "Plan", icon: CalendarDays },
  { href: "/coach", label: "Coach", icon: MessageCircle },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
] as const;

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" || pathname.startsWith("/workout") : pathname.startsWith(href);
}

/** Tab bar markup; `pathname` is null in the prerendered shell. */
export function NavBar({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main navigation" className="tab-bar fixed inset-x-0 bottom-0 z-20 border-t border-line bg-fog/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur">
      <ul className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-3 py-2">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`nav-tab flex flex-col items-center gap-1 rounded-xl py-2 text-xs ${active ? "bg-ink font-semibold text-fog" : "text-muted"}`}
              >
                <Icon size={22} strokeWidth={active ? 2.2 : 1.6} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function BottomNav() {
  return <NavBar pathname={usePathname()} />;
}

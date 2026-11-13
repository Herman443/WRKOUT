import { Suspense } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { AppFeedback } from "@/components/app-feedback";
import { BottomNav, NavBar } from "@/components/bottom-nav";
import { TreadmillResume } from "@/components/treadmill-resume";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* Opaque strip under the iOS status bar so scrolled content does not show through it. */}
      <div aria-hidden className="fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-fog" />
      <main className="relative mx-auto max-w-lg pt-[calc(3rem+env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[calc(6rem+env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))]">
        <div className="mb-8 flex min-h-11 items-center justify-between gap-4">
        <Link href="/" aria-label="WRKOUT home" className="brand-lockup">
          <Activity size={23} strokeWidth={2.5} aria-hidden />
          <span>WRKOUT</span>
        </Link>
        <Suspense>
          <AppFeedback />
        </Suspense>
        </div>
        {children}
      </main>
      <Suspense>
        <TreadmillResume />
      </Suspense>
      <Suspense fallback={<NavBar pathname={null} />}>
        <BottomNav />
      </Suspense>
    </>
  );
}

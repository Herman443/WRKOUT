import { Suspense } from "react";
import { BottomNav, NavBar } from "@/components/bottom-nav";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* Opaque strip under the iOS status bar so scrolled content does not show through it. */}
      <div aria-hidden className="fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-fog" />
      <main className="mx-auto max-w-lg pt-[calc(3rem+env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[calc(6rem+env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))]">{children}</main>
      <Suspense fallback={<NavBar pathname={null} />}>
        <BottomNav />
      </Suspense>
    </>
  );
}

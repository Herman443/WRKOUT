import { Suspense } from "react";
import { BottomNav, NavBar } from "@/components/bottom-nav";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <main className="mx-auto max-w-lg px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28">{children}</main>
      <Suspense fallback={<NavBar pathname={null} />}>
        <BottomNav />
      </Suspense>
    </>
  );
}

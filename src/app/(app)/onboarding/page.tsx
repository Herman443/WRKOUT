import { Suspense } from "react";
import { GoalFields } from "@/components/goal-fields";
import { ProfileFields } from "@/components/profile-fields";
import { SubmitButton } from "@/components/submit-button";
import { PageTitle, Skeleton } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { addDays, todayLocal } from "@/lib/dates";
import { getActivePlan, getProfile } from "@/lib/plan-store";
import { startPlan } from "../actions";

export default function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  return (
    <Suspense fallback={<Skeleton lines={6} />}>
      <Onboarding searchParams={searchParams} />
    </Suspense>
  );
}

async function Onboarding({ searchParams }: Pick<PageProps<"/onboarding">, "searchParams">) {
  await requireSession();
  const [profile, active, params] = await Promise.all([getProfile(), getActivePlan(), searchParams]);
  return (
    <>
      <PageTitle sub={active ? "New goal" : "Welcome"}>What are you training for?</PageTitle>
      {active && (
        <p className="mt-3 text-sm text-muted">
          Starting a new goal replaces your current plan for {active.goal.name}. Your training history stays.
        </p>
      )}
      <form action={startPlan} className="mt-8">
        <GoalFields minDate={addDays(todayLocal(), 7)} />
        {params.error === "date" && <p className="mt-2 text-sm text-z5">Pick a date at least a week from today.</p>}
        <div className="mt-9">
          <ProfileFields profile={profile} />
        </div>
        <SubmitButton pendingText="Starting…" className="mt-10 w-full py-3.5 text-base">
          Build my plan
        </SubmitButton>
        <p className="mt-3 text-center text-sm text-muted">This takes a few minutes. You&apos;ll get a notification when it&apos;s ready.</p>
      </form>
    </>
  );
}

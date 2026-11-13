import { gte, sql } from "drizzle-orm";
import { Suspense } from "react";
import { ProfileFields } from "@/components/profile-fields";
import { PushToggle } from "@/components/push-toggle";
import { SubmitButton } from "@/components/submit-button";
import { PageTitle, Panel, Section, Skeleton, TextLink } from "@/components/ui";
import { db } from "@/db";
import { aiCalls } from "@/db/schema";
import { logout } from "@/app/login/actions";
import { deriveMarkers } from "@/lib/athlete";
import { requireSession } from "@/lib/auth";
import { formatDay, todayLocal } from "@/lib/dates";
import { env } from "@/lib/env";
import { getKv } from "@/lib/ingest";
import { getActivePlan, getProfile } from "@/lib/plan-store";
import { stravaMcpStatus } from "@/lib/strava/mcp-auth";
import { formatPace } from "@/lib/training/vdot";
import { disconnectStrava, saveProfile, syncNow } from "../actions";

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <Suspense fallback={<Skeleton lines={6} />}>
      <Settings searchParams={searchParams} />
    </Suspense>
  );
}

async function Settings({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  await requireSession();
  const params = await searchParams;
  const monthStart = new Date(`${todayLocal().slice(0, 7)}-01T00:00:00Z`);
  const [profile, active, strava, lastPoll, [usage]] = await Promise.all([
    getProfile(),
    getActivePlan(),
    stravaMcpStatus(),
    getKv<{ at: number }>("garmin_last_poll"),
    db
      .select({ cost: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)`, calls: sql<number>`count(*)` })
      .from(aiCalls)
      .where(gte(aiCalls.createdAt, monthStart)),
  ]);
  const m = deriveMarkers(profile);
  const garminConfigured = !!process.env.GARMIN_API_KEY;
  const keyExpires = process.env.GARMIN_API_KEY_EXPIRES;
  const message = typeof params.message === "string" ? params.message : null;
  const connectorUrl = env.mcpSecret ? `${env.appUrl}/api/mcp/${env.mcpSecret}` : null;

  return (
    <>
      <PageTitle>Settings</PageTitle>

      <Section title="Goal">
        {active ? (
          <p className="text-[15px]">
            {active.goal.name}, {formatDay(active.goal.eventDate, { day: "numeric", month: "long", year: "numeric" })}.{" "}
            <TextLink href="/onboarding">Change goal</TextLink>
          </p>
        ) : (
          <TextLink href="/onboarding">Choose a goal</TextLink>
        )}
      </Section>

      <Section title="Notifications">
        <p className="mb-3 text-sm text-muted">Workout analyses, plan changes, your morning session and the Sunday review.</p>
        <PushToggle vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
      </Section>

      <Section title="Connections">
        <div className="space-y-3">
          <Panel>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-medium">Garmin Connect</h3>
              <span className={`text-sm ${garminConfigured ? "text-good" : "text-warn"}`}>{garminConfigured ? "Connected" : "Not set up"}</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {garminConfigured
                ? `Checked ${lastPoll ? new Date(lastPoll.at).toLocaleString("en-GB", { timeZone: "Europe/Oslo", dateStyle: "medium", timeStyle: "short" }) : "never"}.` +
                  (keyExpires ? ` Key expires ${formatDay(keyExpires, { day: "numeric", month: "long", year: "numeric" })}.` : "")
                : "Add GARMIN_API_KEY in Vercel. Create the key in Garmin Connect, under Settings, Personal API."}
            </p>
            {params.synced !== undefined && (
              <p className="mt-1 text-sm text-ink">
                {params.synced === "0" ? "No new activities." : `${params.synced} new ${params.synced === "1" ? "activity" : "activities"} added.`}
              </p>
            )}
            {garminConfigured && (
              <form action={syncNow} className="mt-3">
                <SubmitButton variant="quiet" pendingText="Syncing…">
                  Sync now
                </SubmitButton>
              </form>
            )}
          </Panel>
          <Panel>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-medium">Strava, through Claude</h3>
              <span className={`text-sm ${strava.connected ? "text-good" : "text-muted"}`}>{strava.connected ? "Connected" : "Not connected"}</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              Lets the coach look up your Strava history through Strava&apos;s official MCP server. Needs a Strava subscription.
              Strava currently only accepts its approved assistants, so this is likely to fail; use the Claude app connector
              below instead.
            </p>
            {params.strava === "connected" && <p className="mt-1 text-sm text-good">Strava connected.</p>}
            {params.strava === "error" && <p className="mt-1 text-sm text-z5">Strava connection failed: {message}</p>}
            {strava.lastError && <p className="mt-1 text-sm text-warn">Last error: {strava.lastError}</p>}
            <div className="mt-3">
              {strava.connected ? (
                <form action={disconnectStrava}>
                  <SubmitButton variant="quiet">Disconnect</SubmitButton>
                </form>
              ) : (
                <a href="/api/strava/mcp/connect" className="inline-block rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-fog">
                  Connect Strava
                </a>
              )}
            </div>
          </Panel>
          <Panel>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-medium">Claude app connector</h3>
              <span className={`text-sm ${connectorUrl ? "text-good" : "text-muted"}`}>{connectorUrl ? "On" : "Off"}</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              Talk to Claude about your training with both WRKOUT and Strava. In Claude, add a custom connector with this
              URL, and add Strava&apos;s connector too. Claude can read your plan and analyses, import your Strava sessions,
              and propose changes, which you approve here.
            </p>
            {connectorUrl ? (
              <>
                <p className="mt-3 break-all rounded-xl bg-fog px-3 py-2 font-mono text-xs select-all">{connectorUrl}</p>
                <p className="mt-1 text-sm text-warn">Anyone with this URL can read your training data. To revoke it, change MCP_SECRET.</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">Set MCP_SECRET in Vercel to turn it on.</p>
            )}
          </Panel>
        </div>
      </Section>

      <Section title="Your numbers">
        {m.zones.runPaces ? (
          <p className="text-[15px]">
            Easy <span className="num">{formatPace(m.zones.runPaces.easy[0])}–{formatPace(m.zones.runPaces.easy[1])}</span>, threshold{" "}
            <span className="num">{formatPace(m.zones.runPaces.threshold)}</span>, interval{" "}
            <span className="num">{formatPace(m.zones.runPaces.interval)}</span> per km
            {m.vdot && <span className="text-muted"> (VDOT {m.vdot.toFixed(1)} from {m.vdotSource})</span>}.
          </p>
        ) : (
          <p className="text-[15px] text-muted">Add a recent race time or your zone 2 pace to get personal paces.</p>
        )}
        {params.saved === "profile" && <p className="mt-2 text-sm text-good">Saved.</p>}
        <form action={saveProfile} className="mt-6">
          <ProfileFields profile={profile} />
          <SubmitButton pendingText="Saving…" className="mt-8 w-full py-3">
            Save
          </SubmitButton>
        </form>
      </Section>

      <Section title="AI usage this month">
        <p className="text-[15px]">
          <span className="num text-2xl">${Number(usage?.cost ?? 0).toFixed(2)}</span>
          <span className="text-muted"> across {usage?.calls ?? 0} requests to Claude</span>
        </p>
      </Section>

      <form action={logout} className="mt-10">
        <SubmitButton variant="quiet">Sign out</SubmitButton>
      </form>
    </>
  );
}

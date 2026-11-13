import { after, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs";

// Optional Strava webhook. Strava doesn't sign events, so only events for the configured
// athlete and subscription are accepted. Events are used as a trigger only; the activity
// itself is read through Garmin or, for Strava-only sessions, via the Strava MCP server.

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const token = env.stravaWebhookVerifyToken;
  if (p.get("hub.mode") === "subscribe" && token && p.get("hub.verify_token") === token) {
    return Response.json({ "hub.challenge": p.get("hub.challenge") });
  }
  return Response.json({ error: "forbidden" }, { status: 403 });
}

interface StravaEvent {
  object_type: "activity" | "athlete";
  aspect_type: "create" | "update" | "delete";
  object_id: number;
  owner_id: number;
  subscription_id: number;
  event_time: number;
}

export async function POST(request: Request) {
  const event = (await request.json().catch(() => null)) as StravaEvent | null;
  const athlete = process.env.STRAVA_ATHLETE_ID;
  const subscription = process.env.STRAVA_SUBSCRIPTION_ID;
  const trusted =
    event &&
    athlete &&
    subscription &&
    String(event.owner_id) === athlete &&
    String(event.subscription_id) === subscription;
  if (trusted && event.object_type === "activity" && event.aspect_type === "create") {
    // Give Garmin's own sync a head start so most events pair with a Garmin activity.
    after(() => enqueue("strava_activity", { stravaId: String(event.object_id), eventTime: event.event_time }, 10 * 60 * 1000));
  }
  // Strava expects a fast 200 for every delivery.
  return Response.json({ ok: true });
}

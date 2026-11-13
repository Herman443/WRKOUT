import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { completeStravaMcpAuth } from "@/lib/strava/mcp-auth";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const error = params.get("error");
  const code = params.get("code");
  const state = params.get("state");
  if (error || !code || !state) {
    redirect(`/settings?strava=error&message=${encodeURIComponent(error ?? "Strava did not return a code")}`);
  }
  try {
    await completeStravaMcpAuth(code, state);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    redirect(`/settings?strava=error&message=${encodeURIComponent(message.slice(0, 300))}`);
  }
  redirect("/settings?strava=connected");
}

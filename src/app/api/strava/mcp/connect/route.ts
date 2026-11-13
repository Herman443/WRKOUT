import { redirect } from "next/navigation";
import { startStravaMcpAuth } from "@/lib/strava/mcp-auth";

export async function GET() {
  let url: string;
  try {
    url = await startStravaMcpAuth();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    redirect(`/settings?strava=error&message=${encodeURIComponent(message.slice(0, 300))}`);
  }
  redirect(url);
}

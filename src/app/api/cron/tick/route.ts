import { after } from "next/server";
import { isCronRequest } from "@/lib/crypto";
import { tick } from "@/lib/tick";

// Called every 15 minutes by Supabase pg_cron (see docs/supabase-cron.sql).
export const maxDuration = 300;

async function handle(request: Request) {
  if (!isCronRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const wait = new URL(request.url).searchParams.has("wait");
  if (wait) return Response.json(await tick());
  after(async () => {
    await tick();
  });
  return Response.json({ ok: true }, { status: 202 });
}

export const GET = handle;
export const POST = handle;

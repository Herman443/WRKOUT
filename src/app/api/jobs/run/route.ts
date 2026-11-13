import { after } from "next/server";
import { isCronRequest } from "@/lib/crypto";
import { kickWorker, runOneJob } from "@/lib/jobs";

// One job per invocation so long AI calls each get the full function duration.
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isCronRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  after(async () => {
    if (await runOneJob()) await kickWorker();
  });
  return Response.json({ ok: true }, { status: 202 });
}

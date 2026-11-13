import "server-only";
import { z } from "zod";
import { db } from "@/db";
import { coachMessages } from "@/db/schema";
import { applyOrPropose, getActivePlan } from "../plan-store";
import { sendPush } from "../push";
import { changeSetSchema } from "../training/changes";
import { runStructured } from "./client";
import { buildContext } from "./context";

const replySchema = z.object({
  reply: z.string().describe("Your answer to the athlete, 1-5 sentences"),
  changes: changeSetSchema.describe("Edits to upcoming workouts that the message calls for; empty ops if none"),
});

/**
 * Responds to something the athlete told the coach (or a system event such as missed
 * sessions) and adapts upcoming workouts when needed.
 */
export async function handleCoachNote(text: string, trigger: "coach_note" | "missed") {
  const active = await getActivePlan();
  const task =
    trigger === "coach_note"
      ? `The athlete wrote: """${text}"""\nAnswer them, and change upcoming workouts if what they said calls for it (ids from the context, dates from today on).`
      : `${text}\nDecide whether the next days should change because of this. Don't cram missed work back in. Reply with a short note to the athlete.`;

  const res = await runStructured({
    purpose: trigger,
    context: await buildContext(),
    task,
    schema: replySchema,
    effort: "medium",
    useStrava: trigger === "coach_note",
    maxTokens: 24000,
  });

  const change = active && res.data.changes.ops.length ? await applyOrPropose(active.plan.id, trigger, res.data.changes) : null;
  await db.insert(coachMessages).values({ role: "coach", content: res.data.reply, changeId: change?.id ?? null });

  if (trigger === "missed" || change) {
    await sendPush({
      title: change?.status === "pending" ? "Plan change to review" : "Coach",
      body: res.data.reply.slice(0, 180),
      url: "/coach",
      tag: "coach",
    });
  }
}

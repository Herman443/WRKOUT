"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { coachMessages } from "@/db/schema";
import { requireSession } from "@/lib/auth";

export async function deleteCoachMessage(form: FormData) {
  await requireSession();
  const id = z.uuid().parse(form.get("id"));
  await db.delete(coachMessages).where(eq(coachMessages.id, id));
  revalidatePath("/coach");
}

"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { kv } from "@/db/schema";
import { verifyPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;

type Failures = { count: number; since: number };

export async function login(_prev: { error: string | null }, form: FormData): Promise<{ error: string | null }> {
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  const [row] = await db.select().from(kv).where(eq(kv.key, "login_failures"));
  const failures = (row?.value as Failures | undefined) ?? { count: 0, since: Date.now() };
  const fresh = Date.now() - failures.since > WINDOW_MS ? { count: 0, since: Date.now() } : failures;
  if (fresh.count >= MAX_FAILURES) return { error: "Too many attempts. Try again in 15 minutes." };

  if (!verifyPassword(password, env.appPasswordHash)) {
    const value = { count: fresh.count + 1, since: fresh.since };
    await db.insert(kv).values({ key: "login_failures", value }).onConflictDoUpdate({ target: kv.key, set: { value } });
    await new Promise((r) => setTimeout(r, 600));
    return { error: "That password is not right." };
  }

  await db.delete(kv).where(eq(kv.key, "login_failures"));
  (await cookies()).set(SESSION_COOKIE, await signSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

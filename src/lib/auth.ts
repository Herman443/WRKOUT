import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isValidSession, SESSION_COOKIE } from "./session";

/**
 * Re-checks the session inside pages and server actions (the proxy check is only
 * optimistic). Reading cookies also marks the caller as request-time, so it must run
 * inside a Suspense boundary in pages.
 */
export async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(token))) redirect("/login");
}

import "server-only";
import { eq } from "drizzle-orm";
import { sendNotification, setVapidDetails } from "web-push";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { env } from "./env";

let configured = false;
function configure() {
  if (configured) return true;
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  configured = true;
  return true;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Sends to every registered device; prunes subscriptions the push service has dropped. */
export async function sendPush(message: PushMessage): Promise<number> {
  if (!configure()) return 0;
  const subs = await db.select().from(pushSubscriptions);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(message),
          { TTL: 60 * 60 * 12 },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint));
        } else {
          console.error("push failed", status, e);
        }
      }
    }),
  );
  return sent;
}

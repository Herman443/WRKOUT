import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { kv } from "@/db/schema";

export async function getKv<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(kv).where(eq(kv.key, key));
  return (row?.value as T | undefined) ?? null;
}

export async function setKv(key: string, value: unknown) {
  await db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } });
}



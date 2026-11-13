import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// One pooled connection per serverless instance. `prepare: false` is required for
// Supabase's transaction-mode pooler (port 6543).
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

const sql =
  globalForDb.sql ??
  postgres(process.env.DATABASE_URL ?? "postgres://localhost:5432/wrkout", {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    idle_timeout: 20,
  });
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql, { schema });
export { schema };

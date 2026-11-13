import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// A small pool per serverless instance, tuned for Supabase's transaction-mode pooler
// (Supavisor, port 6543):
// - `prepare: false`: the pooler doesn't support prepared statements.
// - `max_pipeline: 1`: Supavisor (before 2.10) never answers queries pipelined on one
//   connection, so pages running several queries at once hang forever.
// - timeouts: a stalled pooler or wrong host fails the request instead of leaving the
//   page on its loading skeleton.
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

const sql =
  globalForDb.sql ??
  postgres(process.env.DATABASE_URL ?? "postgres://localhost:5432/wrkout", {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    max_pipeline: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    queue_timeout: 20,
    query_timeout: 30,
  });
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql, { schema });
export { schema };

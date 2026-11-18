import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("applies the migrations and creates indexes for page queries", async () => {
  const db = new PGlite();
  try {
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries) {
      await db.exec(await readFile(`drizzle/${tag}.sql`, "utf8"));
    }
    const { rows } = await db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname = 'wrkout'");
    expect(rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      "activities_local_date_idx", "ai_calls_created_idx", "analyses_created_idx",
      "analyses_activity_created_idx", "analyses_kind_created_idx", "coach_messages_created_idx",
      "plan_changes_status_created_idx", "planned_workouts_plan_date_idx",
    ]));
  } finally {
    await db.close();
  }
}, 30000);

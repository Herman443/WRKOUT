// Prints the notes written with the feedback button, oldest first, against whatever
// DATABASE_URL .env.local points at (production, usually).
// Usage:
//   npm run feedback                  open notes
//   npm run feedback -- --all         open and done notes
//   npm run feedback -- --json        as JSON, for tooling
//   npm run feedback -- --done <id…>  mark notes done (no ids: every open note)
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { appFeedback } from "../src/db/schema";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);

async function main() {
  if (flag("done")) {
    const ids = args.filter((a) => !a.startsWith("--"));
    const done = await db
      .update(appFeedback)
      .set({ status: "done" })
      .where(ids.length ? inArray(appFeedback.id, ids) : eq(appFeedback.status, "open"))
      .returning({ id: appFeedback.id });
    console.log(`Marked ${done.length} ${done.length === 1 ? "note" : "notes"} done.`);
    return;
  }

  const rows = await db
    .select()
    .from(appFeedback)
    .where(flag("all") ? undefined : eq(appFeedback.status, "open"))
    .orderBy(asc(appFeedback.createdAt));

  if (flag("json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!rows.length) {
    console.log("No feedback.");
    return;
  }
  for (const r of rows) {
    const at = r.createdAt.toLocaleString("en-GB", { timeZone: "Europe/Oslo", dateStyle: "medium", timeStyle: "short" });
    console.log(`${at}  ${r.page ?? "?"}${r.status === "done" ? "  (done)" : ""}  ${r.id}`);
    console.log(`  ${r.body.replace(/\n/g, "\n  ")}\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());

// Checks the Garmin Personal API end to end with your key: token, activities, FIT, health.
// Usage: npm run spike:garmin   (needs GARMIN_API_KEY and a database for the token cache)
import { addDays, todayLocal } from "../src/lib/dates";
import { garmin } from "../src/lib/garmin/client";
import { parseFit } from "../src/lib/garmin/fit";
import { mapActivitySummary } from "../src/lib/garmin/map";

async function main() {
  const today = todayLocal();
  const list = (await garmin.searchActivities({ startDate: addDays(today, -14), endDate: today, limit: 5 })) ?? [];
  console.log(`\n${list.length} activities in the last 14 days`);
  for (const a of list) {
    const m = mapActivitySummary(a);
    console.log(`- ${m.localDate} ${m.sport} "${m.name}" ${Math.round(m.durationSec / 60)} min, ${m.distanceM ? (m.distanceM / 1000).toFixed(1) : "-"} km, HR ${m.avgHr ?? "-"}`);
  }
  if (list[0]) {
    console.log("\nFields on the newest activity:", Object.keys(list[0]).sort().join(", "));
    const fit = parseFit(await garmin.downloadActivity(String(list[0].activityId)));
    console.log(`FIT: ${fit.laps.length} laps, NP ${fit.normalizedPowerW ?? "-"}`);
  }
  const [sleep, hrv, summaries] = await Promise.all([garmin.dailySleep(today), garmin.dailyHrv(today), garmin.dailySummaries(today, today)]);
  console.log("\nSleep keys:", sleep ? Object.keys(sleep).join(", ") : "none");
  console.log("HRV keys:", hrv ? Object.keys(hrv).join(", ") : "none");
  console.log("Daily summary:", summaries ? JSON.stringify(summaries).slice(0, 400) : "none");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

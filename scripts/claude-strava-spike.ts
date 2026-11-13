// Verifies that Claude can reach Strava's MCP server with the token stored by
// Settings → Connect Strava, combined with structured output.
// Usage: npm run spike:claude-strava   (costs a few cents)
import { z } from "zod";
import { runStructured } from "../src/lib/ai/client";
import { getStravaMcpToken } from "../src/lib/strava/mcp-auth";

async function main() {
  if (!(await getStravaMcpToken())) {
    console.error("Strava is not connected. Open Settings in the app and choose Connect Strava first.");
    process.exit(1);
  }
  const res = await runStructured({
    purpose: "spike",
    context: "This is a connectivity test.",
    task: "Use the Strava tools to list my three most recent activities.",
    schema: z.object({
      activities: z.array(z.object({ name: z.string(), date: z.string(), sport: z.string(), distanceKm: z.number().nullable() })),
      toolsUsed: z.array(z.string()),
    }),
    effort: "low",
    useStrava: true,
    maxTokens: 8000,
  });
  console.log(JSON.stringify(res.data, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

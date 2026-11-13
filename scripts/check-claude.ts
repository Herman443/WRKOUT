// Checks the Claude endpoint the app is configured for (ANTHROPIC_BASE_URL, or
// api.anthropic.com) feature by feature, using tiny requests (well under a cent each).
// Usage: npm run check:claude            (add -- --strava to also test the Strava MCP connector)
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const base = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
const key = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? "";
const model = process.env.COACH_MODEL ?? "claude-opus-5-5";
const client = new Anthropic({ maxRetries: 0 });
const results: Record<string, boolean> = {};

async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    console.log(`  ok    ${name}${detail ? `: ${detail}` : ""}`);
    results[name] = true;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 240)}`);
    results[name] = false;
  }
}

const ask = (extra: object = {}, betas: string[] = []) =>
  client.beta.messages
    .create({
      model,
      max_tokens: 2000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      ...(betas.length ? { betas } : {}),
      ...extra,
    })
    .withResponse();

async function main() {
  console.log(`Endpoint    ${base}`);
  console.log(`Credential  ${process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : process.env.ANTHROPIC_AUTH_TOKEN ? "ANTHROPIC_AUTH_TOKEN" : "none found"}`);
  console.log(`Model       ${model}\n`);

  let modelIds: string[] = [];
  await check("Model list", async () => {
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${key}`, "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data?: { id: string }[] };
    modelIds = (body.data ?? []).map((m) => m.id).filter((id) => /claude|opus|sonnet|haiku/i.test(id));
    return modelIds.length ? modelIds.join(", ") : "no Claude models in the list";
  });

  await check("Basic message", async () => {
    const { data, response } = await ask();
    const text = data.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    const cost = response.headers.get("x-litellm-response-cost");
    return `"${text}" from ${data.model}${cost ? `, gateway cost $${cost}` : ""}`;
  });

  await check("Structured output (the app needs this)", async () => {
    const message = await client.beta.messages
      .stream({
        model,
        max_tokens: 2000,
        output_config: { effort: "low", format: betaZodOutputFormat(z.object({ ok: z.boolean(), word: z.string() })) },
        messages: [{ role: "user", content: "Return ok=true and the word 'ready'." }],
      })
      .finalMessage();
    if (!message.parsed_output) throw new Error("no parsed output");
    return JSON.stringify(message.parsed_output);
  });

  await check("Server-side refusal fallbacks (optional)", async () => {
    await ask({ fallbacks: "default" }, ["server-side-fallback-2026-07-01"]);
  });

  await check("Top-level prompt caching (optional)", async () => {
    await ask({ cache_control: { type: "ephemeral" } });
  });

  if (process.argv.includes("--strava")) {
    await check("Strava MCP connector (optional)", async () => {
      const { getStravaMcpToken, STRAVA_MCP_URL } = await import("../src/lib/strava/mcp-auth");
      const token = await getStravaMcpToken();
      if (!token) throw new Error("Strava is not connected; use Settings → Connect Strava first");
      const { data } = await client.beta.messages
        .create({
          model,
          max_tokens: 4000,
          output_config: { effort: "low" },
          betas: ["mcp-client-2025-11-20"],
          mcp_servers: [{ type: "url", url: STRAVA_MCP_URL, name: "strava", authorization_token: token }],
          tools: [{ type: "mcp_toolset", mcp_server_name: "strava" }],
          messages: [{ role: "user", content: "Use the Strava tools to name my most recent activity. Answer in one line." }],
        })
        .withResponse();
      return data.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim().slice(0, 120);
    });
  }

  console.log("");
  if (results["Basic message"] === false) {
    const alt = modelIds.find((id) => /opus/i.test(id)) ?? modelIds[0];
    console.log(alt ? `The model name may differ on this endpoint. Try COACH_MODEL=${alt}` : "Basic requests fail: check the key and base URL.");
  } else if (results["Structured output (the app needs this)"] === false) {
    console.log("This endpoint can't do structured outputs, which the app relies on. It won't work through it as-is.");
  } else {
    console.log("The app will work through this endpoint.");
    if (results["Server-side refusal fallbacks (optional)"] === false || results["Top-level prompt caching (optional)"] === false)
      console.log("Unsupported optional features are switched off automatically at runtime (or set CLAUDE_SERVER_FALLBACKS=off).");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

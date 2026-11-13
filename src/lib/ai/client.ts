import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlock, BetaMessage, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { db } from "@/db";
import { aiCalls } from "@/db/schema";
import { getStravaMcpToken, STRAVA_MCP_URL } from "../strava/mcp-auth";
import { parseJsonReply } from "./json";
import { COACH_SYSTEM } from "./prompts";

export const COACH_MODEL = process.env.COACH_MODEL ?? "claude-opus-5-5";

// $ per million tokens (input, output, cache read, 5-minute cache write)
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
};

export class AiError extends Error {}

// Endpoint and credentials come from the environment: ANTHROPIC_API_KEY or
// ANTHROPIC_AUTH_TOKEN, plus ANTHROPIC_BASE_URL when going through a gateway (e.g. a
// LiteLLM proxy). Without a base URL the SDK talks to api.anthropic.com directly.
let anthropic: Anthropic | null = null;
const client = () => (anthropic ??= new Anthropic({ maxRetries: 3 }));

/**
 * Optional request features, in the order they are given up when a gateway rejects a
 * request (gateways that route Claude through Bedrock or Vertex may not support them).
 * Once dropped, a feature stays off for the life of the process.
 */
type OptionalFeature = "fallbacks" | "autoCache" | "mcp";
const DEGRADE_ORDER: OptionalFeature[] = ["fallbacks", "autoCache", "mcp"];
const unsupported = new Set<OptionalFeature>(process.env.CLAUDE_SERVER_FALLBACKS === "off" ? ["fallbacks"] : []);

export interface StructuredRequest<S extends z.ZodType> {
  /** Label for the usage log */
  purpose: string;
  /** Athlete/plan context, sent as a second system block after the stable coach prompt */
  context: string;
  task: string;
  schema: S;
  effort: "low" | "medium" | "high" | "xhigh";
  /** Attach the Strava MCP server (when connected) so Claude can look things up */
  useStrava?: boolean;
  maxTokens?: number;
  /** Earlier turns, for follow-ups such as "fix these guardrail violations" */
  history?: BetaMessageParam[];
}

export interface StructuredResult<T> {
  data: T;
  /** The turns to pass as `history` for a follow-up request */
  history: BetaMessageParam[];
  usedStrava: boolean;
}

export async function runStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  const stravaToken = req.useStrava ? await getStravaMcpToken() : null;
  const messages: BetaMessageParam[] = [...(req.history ?? []), { role: "user", content: req.task }];
  let usedStrava = false;
  let repaired = false;

  // pause_turn means a long server-side tool loop was paused; resume by sending it back.
  for (let turn = 0; turn < 5; turn++) {
    const { message, mcp } = await send(req, messages, stravaToken);
    usedStrava ||= mcp;
    await logUsage(req.purpose, message);
    const content = message.content as BetaContentBlock[];

    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content });
      continue;
    }
    if (message.stop_reason === "refusal") {
      throw new AiError(`The model declined (${message.stop_details?.category ?? "unspecified"})`);
    }
    if (message.stop_reason === "max_tokens") throw new AiError("The response was cut off at max_tokens");

    const text = content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const parsed = parseJsonReply(req.schema, text);
    if (parsed.ok) {
      return { data: parsed.data, history: [...messages, { role: "assistant", content }], usedStrava };
    }
    // Gateways that don't enforce the schema occasionally return fenced or slightly off
    // JSON; give the model one chance to correct it.
    if (repaired) throw new AiError(`The response did not match the expected format: ${parsed.error}`);
    repaired = true;
    messages.push(
      { role: "assistant", content },
      {
        role: "user",
        content:
          `That reply could not be used: ${parsed.error}\n` +
          `Reply again with only the JSON object, no code fences, matching this JSON schema:\n` +
          JSON.stringify(z.toJSONSchema(req.schema)),
      },
    );
  }
  throw new AiError("The model kept pausing; giving up");
}

/**
 * The schema is sent to the API (strictly enforced by Anthropic's own endpoint), but
 * parsing is ours: `parse` hands back the raw text so the SDK never throws on output a
 * gateway failed to constrain.
 */
function outputFormat(schema: z.ZodType) {
  const { schema: jsonSchema } = betaZodOutputFormat(schema);
  return { type: "json_schema" as const, schema: jsonSchema, parse: (content: string) => content };
}

/** One streamed request, retried without optional features if the endpoint rejects it. */
async function send<S extends z.ZodType>(req: StructuredRequest<S>, messages: BetaMessageParam[], stravaToken: string | null) {
  for (;;) {
    const on = (f: OptionalFeature) => !unsupported.has(f);
    const mcp = !!stravaToken && on("mcp");
    const betas = [...(on("fallbacks") ? ["server-side-fallback-2026-07-01"] : []), ...(mcp ? ["mcp-client-2025-11-20"] : [])];
    try {
      const message = await client()
        .beta.messages.stream({
          model: COACH_MODEL,
          max_tokens: req.maxTokens ?? 32000,
          ...(betas.length ? { betas } : {}),
          ...(on("fallbacks") ? { fallbacks: "default" as const } : {}),
          ...(on("autoCache") ? { cache_control: { type: "ephemeral" as const } } : {}),
          // Summarised thinking streams while the model reasons. With the default
          // ("omitted") the stream can sit silent for over a minute, and proxies with an
          // idle timeout (e.g. ~60 s on LiteLLM gateways) drop the connection.
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: req.effort, format: outputFormat(req.schema) },
          system: [
            { type: "text", text: COACH_SYSTEM },
            { type: "text", text: req.context },
          ],
          messages,
          ...(mcp
            ? {
                mcp_servers: [{ type: "url" as const, url: STRAVA_MCP_URL, name: "strava", authorization_token: stravaToken }],
                tools: [{ type: "mcp_toolset" as const, mcp_server_name: "strava" }],
              }
            : {}),
        })
        .finalMessage();
      return { message, mcp };
    } catch (e) {
      const next = DEGRADE_ORDER.find((f) => on(f) && (f !== "mcp" || mcp));
      if (!(e instanceof Anthropic.BadRequestError) || !next) throw e;
      console.warn(`Claude endpoint rejected the request; retrying without "${next}": ${e.message}`);
      unsupported.add(next);
    }
  }
}

async function logUsage(purpose: string, m: BetaMessage) {
  const u = m.usage;
  const [pin, pout, pread, pwrite] = PRICES[m.model] ?? PRICES[COACH_MODEL] ?? [0, 0, 0, 0];
  const cost =
    ((u.input_tokens ?? 0) * pin +
      (u.output_tokens ?? 0) * pout +
      (u.cache_read_input_tokens ?? 0) * pread +
      (u.cache_creation_input_tokens ?? 0) * pwrite) /
    1e6;
  try {
    await db.insert(aiCalls).values({
      purpose,
      model: m.model,
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      costUsd: cost,
    });
  } catch (e) {
    console.error("failed to log AI usage", e);
  }
}

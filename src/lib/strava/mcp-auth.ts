import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { decrypt, encrypt } from "../crypto";
import { env } from "../env";

// OAuth 2.1 client for Strava's official MCP server, using dynamic client registration
// and PKCE (endpoints from https://www.strava.com/.well-known/oauth-authorization-server/mcp-issuer).
// The resulting access token is handed to the Claude API's MCP connector; WRKOUT itself
// never calls the Strava API with it.

export const STRAVA_MCP_URL = "https://mcp.strava.com/mcp";
const AUTHORIZE_URL = "https://www.strava.com/oauth/mcp/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/mcp/token";
const REGISTER_URL = "https://www.strava.com/oauth/mcp/register_client";
const SCOPES = "read activity:read_all profile:read_all";

interface StravaMcpState {
  clientId?: string;
  clientSecret?: string | null;
  redirectUri?: string;
  pending?: { state: string; verifier: string; createdAt: number };
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  connectedAt?: number;
  lastError?: string | null;
}

const redirectUri = () => `${env.appUrl}/api/strava/mcp/callback`;

async function load(): Promise<StravaMcpState> {
  const [row] = await db.select().from(integrations).where(eq(integrations.key, "strava_mcp"));
  return (row?.data as StravaMcpState | undefined) ?? {};
}

async function save(data: StravaMcpState) {
  const value = data as Record<string, unknown>;
  await db
    .insert(integrations)
    .values({ key: "strava_mcp", data: value })
    .onConflictDoUpdate({ target: integrations.key, set: { data: value } });
}

async function ensureClient(state: StravaMcpState): Promise<StravaMcpState> {
  if (state.clientId && state.redirectUri === redirectUri()) return state;
  const res = await fetch(REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "WRKOUT",
      redirect_uris: [redirectUri()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`Strava rejected client registration (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { client_id: string; client_secret?: string };
  return {
    ...state,
    clientId: body.client_id,
    clientSecret: body.client_secret ? encrypt(body.client_secret) : null,
    redirectUri: redirectUri(),
  };
}

/** Starts the OAuth flow; returns the Strava consent URL to redirect to. */
export async function startStravaMcpAuth(): Promise<string> {
  const state = await ensureClient(await load());
  const verifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  await save({ ...state, pending: { state: nonce, verifier, createdAt: Date.now() } });

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", state.clientId!);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", nonce);
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", STRAVA_MCP_URL);
  return url.toString();
}

async function tokenRequest(state: StravaMcpState, params: Record<string, string>) {
  const body = new URLSearchParams({ client_id: state.clientId!, ...params });
  if (state.clientSecret) body.set("client_secret", decrypt(state.clientSecret));
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`Strava token request failed (${res.status}): ${await res.text()}`);
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; expires_at?: number };
  return {
    accessToken: encrypt(t.access_token),
    refreshToken: t.refresh_token ? encrypt(t.refresh_token) : state.refreshToken,
    expiresAt: t.expires_at ? t.expires_at * 1000 : Date.now() + (t.expires_in ?? 3600) * 1000,
  };
}

export async function completeStravaMcpAuth(code: string, returnedState: string) {
  const state = await load();
  if (!state.pending || state.pending.state !== returnedState) throw new Error("OAuth state mismatch; start again");
  if (Date.now() - state.pending.createdAt > 15 * 60 * 1000) throw new Error("OAuth attempt expired; start again");
  const tokens = await tokenRequest(state, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: state.pending.verifier,
    resource: STRAVA_MCP_URL,
  });
  await save({ ...state, ...tokens, pending: undefined, connectedAt: Date.now(), lastError: null });
}

/** A valid access token for the Strava MCP server, or null when not connected. */
export async function getStravaMcpToken(): Promise<string | null> {
  const state = await load();
  if (!state.accessToken) return null;
  if (state.expiresAt && state.expiresAt - Date.now() > 5 * 60 * 1000) return decrypt(state.accessToken);
  if (!state.refreshToken) return null;
  try {
    const tokens = await tokenRequest(state, {
      grant_type: "refresh_token",
      refresh_token: decrypt(state.refreshToken),
      resource: STRAVA_MCP_URL,
    });
    await save({ ...state, ...tokens, lastError: null });
    return decrypt(tokens.accessToken);
  } catch (e) {
    await save({ ...state, lastError: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function stravaMcpStatus() {
  const s = await load();
  return { connected: !!s.accessToken, connectedAt: s.connectedAt ?? null, lastError: s.lastError ?? null };
}

export async function disconnectStravaMcp() {
  const s = await load();
  await save({ clientId: s.clientId, clientSecret: s.clientSecret, redirectUri: s.redirectUri });
}

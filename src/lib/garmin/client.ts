import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { decrypt, encrypt } from "../crypto";
import { env } from "../env";

// Garmin Connect Personal API (read-only, pull-only). A personal API key (valid up to a
// year) is exchanged for a 24 h bearer JWT; there are no refresh tokens, so we re-exchange
// when the cached token is within an hour of expiry. Paths follow Garmin's official client
// (github.com/garmin/connect-personal-api-python).

const BASE_URL = process.env.GARMIN_BASE_URL ?? "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const REFRESH_WINDOW_MS = 60 * 60 * 1000;

export class GarminError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

type TokenCache = { token: string; expiresAt: number };

function jwtExpiry(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  return Number(payload.exp) * 1000;
}

async function exchangeKey(apiKey: string): Promise<TokenCache> {
  const res = await fetch(`${BASE_URL}${TOKEN_PATH}`, {
    method: "POST",
    headers: { Accept: "*/*", Authorization: `ApiKey ${apiKey}` },
  });
  if (!res.ok) throw new GarminError(`Garmin token exchange failed (${res.status}): ${await res.text()}`, res.status);
  const text = (await res.text()).trim();
  // The endpoint answers with a bare JWT; tolerate a JSON wrapper just in case.
  const token = text.startsWith("{") ? (JSON.parse(text).access_token as string) : text;
  return { token, expiresAt: jwtExpiry(token) };
}

async function bearer(forceRefresh = false): Promise<string> {
  const apiKey = env.garminApiKey;
  if (!apiKey) throw new GarminError("GARMIN_API_KEY is not set");

  if (!forceRefresh) {
    const [row] = await db.select().from(integrations).where(eq(integrations.key, "garmin"));
    const cached = row?.data as { token?: string; expiresAt?: number } | undefined;
    if (cached?.token && cached.expiresAt && cached.expiresAt - Date.now() > REFRESH_WINDOW_MS) {
      return decrypt(cached.token);
    }
  }

  const fresh = await exchangeKey(apiKey);
  const data = { token: encrypt(fresh.token), expiresAt: fresh.expiresAt, lastExchangeAt: Date.now() };
  await db
    .insert(integrations)
    .values({ key: "garmin", data })
    .onConflictDoUpdate({ target: integrations.key, set: { data } });
  return fresh.token;
}

async function request(path: string, params?: Record<string, string | number>, accept = "application/json") {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
  let res = await fetch(url, { headers: { Accept: accept, Authorization: `Bearer ${await bearer()}` } });
  if (res.status === 401) {
    res = await fetch(url, { headers: { Accept: accept, Authorization: `Bearer ${await bearer(true)}` } });
  }
  if (!res.ok) throw new GarminError(`Garmin GET ${path} failed (${res.status})`, res.status);
  return res;
}

export async function garminGet<T = unknown>(path: string, params?: Record<string, string | number>): Promise<T | null> {
  const res = await request(path, params);
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

/** Returns null instead of throwing for endpoints that may not exist for this account. */
export async function garminGetOptional<T = unknown>(path: string, params?: Record<string, string | number>) {
  try {
    return await garminGet<T>(path, params);
  } catch (e) {
    if (e instanceof GarminError && (e.status === 404 || e.status === 400 || e.status === 204)) return null;
    throw e;
  }
}

export const garmin = {
  searchActivities: (opts: { startDate?: string; endDate?: string; limit?: number; start?: number }) =>
    garminGet<GarminActivitySummary[]>("/activitylist-service/activities/search/activities", {
      start: opts.start ?? 0,
      limit: opts.limit ?? 20,
      ...(opts.startDate ? { startDate: opts.startDate } : {}),
      ...(opts.endDate ? { endDate: opts.endDate } : {}),
    }),
  getActivity: (id: string) => garminGetOptional<Record<string, unknown>>(`/activity-service/activity/${id}`),
  /** Original activity file, as ZIP bytes containing the .fit */
  downloadActivity: async (id: string) => {
    const res = await request(
      `/download-service/files/activity/${id}`,
      undefined,
      "application/zip, application/x-zip-compressed, application/octet-stream",
    );
    return new Uint8Array(await res.arrayBuffer());
  },
  dailySleep: (date: string) => garminGetOptional<Record<string, unknown>>("/sleep-service/sleep/dailySleep", { date }),
  dailyHrv: (date: string) => garminGetOptional<Record<string, unknown>>(`/hrv-service/hrv/${date}`),
  dailySummaries: (startDate: string, endDate: string) =>
    garminGetOptional<Record<string, unknown>>("/usersummary-service/v2/dailysummaries", { startDate, endDate }),
  bodyBattery: (startDate: string, endDate: string) =>
    garminGetOptional<unknown>("/wellness-service/wellness/bodyBattery/reports/daily", { startDate, endDate }),
  heartRateZones: () => garminGetOptional<unknown>("/biometric-service/heartRateZones/v2"),
};

/** Fields we read from the activity search endpoint (others are kept raw in `extra`). */
export interface GarminActivitySummary {
  activityId: number;
  activityName?: string;
  startTimeGMT?: string;
  startTimeLocal?: string;
  activityType?: { typeKey?: string; parentTypeId?: number };
  distance?: number;
  duration?: number;
  elapsedDuration?: number;
  movingDuration?: number;
  elevationGain?: number;
  averageHR?: number;
  maxHR?: number;
  avgPower?: number;
  normPower?: number;
  averageRunningCadenceInStepsPerMinute?: number;
  averageBikingCadenceInRevPerMinute?: number;
  calories?: number;
  aerobicTrainingEffect?: number;
  anaerobicTrainingEffect?: number;
  activityTrainingLoad?: number;
  vO2MaxValue?: number;
  [key: string]: unknown;
}

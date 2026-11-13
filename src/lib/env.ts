// Typed access to required environment variables, failing loudly at the point of use
// (not at import, so `next build` works without secrets).

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get appPasswordHash() {
    return required("APP_PASSWORD_HASH");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get garminApiKey() {
    return process.env.GARMIN_API_KEY ?? null;
  },
  get tokenEncryptionKey() {
    return required("TOKEN_ENCRYPTION_KEY");
  },
  get vapidPublicKey() {
    return required("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  },
  get vapidPrivateKey() {
    return required("VAPID_PRIVATE_KEY");
  },
  get vapidSubject() {
    return process.env.VAPID_SUBJECT ?? "mailto:admin@hermanostengen.com";
  },
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get stravaWebhookVerifyToken() {
    return process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? null;
  },
  /** Secret path segment of the Claude app connector at /api/mcp/<secret>; unset turns it off */
  get mcpSecret() {
    const value = process.env.MCP_SECRET;
    return value && value.length >= 32 ? value : null;
  },
};

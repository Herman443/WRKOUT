// Prints fresh values for every generated secret. Paste them into .env.local and Vercel.
// Usage: npm run setup:secrets -- "your app password"
import { randomBytes } from "node:crypto";
import { generateVAPIDKeys } from "web-push";
import { hashPassword } from "../src/lib/crypto";

const password = process.argv[2] ?? randomBytes(12).toString("base64url");
const vapid = generateVAPIDKeys();

if (!process.argv[2]) console.log(`# Generated app password (save it in your password manager): ${password}\n`);
console.log(`APP_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
console.log(`CRON_SECRET=${randomBytes(32).toString("base64url")}`);
console.log(`TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapid.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapid.privateKey}`);
console.log(`STRAVA_WEBHOOK_VERIFY_TOKEN=${randomBytes(16).toString("base64url")}`);

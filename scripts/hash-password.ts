// Usage: npm run hash-password -- "new password"   → prints APP_PASSWORD_HASH
import { hashPassword } from "../src/lib/crypto";

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your password"');
  process.exit(1);
}
console.log(`APP_PASSWORD_HASH=${hashPassword(password)}`);

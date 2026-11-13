import { jwtVerify, SignJWT } from "jose";

// Edge-safe session token helpers (used by proxy.ts and server code alike).

export const SESSION_COOKIE = "wrkout_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "");

export async function signSession(): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token || !process.env.SESSION_SECRET) return false;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.sub === "owner";
  } catch {
    return false;
  }
}

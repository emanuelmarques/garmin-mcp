import { jwtVerify, SignJWT, type JWTPayload } from "jose";

export type TokenKind = "client" | "code" | "access" | "refresh";

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signJwt(
  secret: string,
  kind: TokenKind,
  claims: Record<string, unknown>,
  ttlSec: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims, kind })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSec)
    .sign(key(secret));
}

/** Throws unless the signature is valid, the token is unexpired and `kind` matches. */
export async function verifyJwt(secret: string, kind: TokenKind, token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
  if (payload.kind !== kind) throw new Error("wrong token kind");
  return payload;
}

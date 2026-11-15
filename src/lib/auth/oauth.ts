import { createHash, timingSafeEqual } from "node:crypto";

/** S256 PKCE check: base64url(sha256(verifier)) === challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return safeEqual(computed, challenge);
}

export function isRegisteredRedirect(client: { redirectUris: string[] }, uri: string): boolean {
  return client.redirectUris.includes(uri);
}

/** Constant-time string comparison (length differences leak only the length). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

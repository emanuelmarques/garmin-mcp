import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/auth/store";
import { signJwt, verifyJwt } from "@/lib/auth/tokens";
import { isRegisteredRedirect, verifyPkce } from "@/lib/auth/oauth";

const SECRET = "x".repeat(32);

describe("MemoryStore", () => {
  it("consumeOnce is true only the first time", async () => {
    const s = new MemoryStore();
    expect(await s.consumeOnce("a", 60)).toBe(true);
    expect(await s.consumeOnce("a", 60)).toBe(false);
  });
  it("consumeOnce frees the id after the ttl", async () => {
    let t = 0;
    const s = new MemoryStore(() => t);
    await s.consumeOnce("a", 1);
    t = 2000;
    expect(await s.consumeOnce("a", 1)).toBe(true);
  });
  it("hit blocks after max attempts in the window", async () => {
    const s = new MemoryStore();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await s.hit("ip", 900, 5));
    expect(results).toEqual([true, true, true, true, true, false]);
  });
  it("hit window resets", async () => {
    let t = 0;
    const s = new MemoryStore(() => t);
    for (let i = 0; i < 6; i++) await s.hit("ip", 10, 5);
    t = 11_000;
    expect(await s.hit("ip", 10, 5)).toBe(true);
  });
});

describe("jwt", () => {
  it("round-trips claims", async () => {
    const tok = await signJwt(SECRET, "access", { sub: "me" }, 60);
    expect((await verifyJwt(SECRET, "access", tok)).sub).toBe("me");
  });
  it("rejects another kind", async () => {
    const tok = await signJwt(SECRET, "access", {}, 60);
    await expect(verifyJwt(SECRET, "refresh", tok)).rejects.toThrow();
  });
  it("rejects another secret", async () => {
    const tok = await signJwt(SECRET, "access", {}, 60);
    await expect(verifyJwt("y".repeat(32), "access", tok)).rejects.toThrow();
  });
  it("rejects an expired token", async () => {
    const tok = await signJwt(SECRET, "access", {}, -10);
    await expect(verifyJwt(SECRET, "access", tok)).rejects.toThrow();
  });
  it("rejects garbage", async () => {
    await expect(verifyJwt(SECRET, "access", "not.a.jwt")).rejects.toThrow();
  });
});

describe("pkce and redirects", () => {
  it("verifies the RFC 7636 example pair", () => {
    expect(verifyPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
  });
  it("rejects a wrong verifier", () => {
    expect(verifyPkce("wrong", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
  });
  it("matches redirect URIs exactly", () => {
    const c = { redirectUris: ["https://claude.ai/api/mcp/auth_callback"] };
    expect(isRegisteredRedirect(c, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isRegisteredRedirect(c, "https://claude.ai/api/mcp/auth_callback/")).toBe(false);
    expect(isRegisteredRedirect(c, "https://evil.example/cb")).toBe(false);
  });
});

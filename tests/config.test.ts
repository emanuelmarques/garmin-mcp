import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";

const base = { GARMIN_API_KEY: "g", ACCESS_KEY: "k".repeat(20), SIGNING_SECRET: "s".repeat(32) };

describe("loadConfig", () => {
  it("names the missing variable without printing values", () => {
    expect(() => loadConfig({})).toThrow(/GARMIN_API_KEY/);
  });
  it("returns the config when required variables are set", () => {
    expect(loadConfig(base)).toEqual({
      garminApiKey: "g",
      accessKey: "k".repeat(20),
      signingSecret: "s".repeat(32),
      garminKeyExpires: undefined,
      allowedRedirectHosts: undefined,
    });
  });
  it("rejects a weak ACCESS_KEY (< 20 chars)", () => {
    expect(() => loadConfig({ ...base, ACCESS_KEY: "short-password" })).toThrow(/ACCESS_KEY/);
  });
  it("parses ALLOWED_REDIRECT_HOSTS as a lowercase list", () => {
    expect(loadConfig({ ...base, ALLOWED_REDIRECT_HOSTS: "Claude.ai, chatgpt.com" }).allowedRedirectHosts).toEqual([
      "claude.ai",
      "chatgpt.com",
    ]);
  });
  it("rejects a malformed GARMIN_KEY_EXPIRES", () => {
    expect(() => loadConfig({ ...base, GARMIN_KEY_EXPIRES: "x" })).toThrow(/GARMIN_KEY_EXPIRES/);
  });
  it("rejects a short SIGNING_SECRET", () => {
    expect(() => loadConfig({ ...base, SIGNING_SECRET: "short" })).toThrow(/SIGNING_SECRET/);
  });
});

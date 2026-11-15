import { z } from "zod";

const schema = z.object({
  GARMIN_API_KEY: z.string().min(1),
  ACCESS_KEY: z.string().min(20),
  ALLOWED_REDIRECT_HOSTS: z.string().optional(),
  SIGNING_SECRET: z.string().min(32),
  GARMIN_KEY_EXPIRES: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type Config = {
  garminApiKey: string;
  accessKey: string;
  signingSecret: string;
  garminKeyExpires?: string;
  /** If set, only these redirect hosts (exact match; localhost always allowed) may register. */
  allowedRedirectHosts?: string[];
};

/** Reads and validates env vars. Errors name the variable, never its value. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse({
    GARMIN_API_KEY: env.GARMIN_API_KEY,
    ACCESS_KEY: env.ACCESS_KEY,
    SIGNING_SECRET: env.SIGNING_SECRET,
    GARMIN_KEY_EXPIRES: env.GARMIN_KEY_EXPIRES || undefined,
    ALLOWED_REDIRECT_HOSTS: env.ALLOWED_REDIRECT_HOSTS || undefined,
  });
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Invalid or missing environment variables: ${names.join(", ")}`);
  }
  const d = parsed.data;
  return {
    garminApiKey: d.GARMIN_API_KEY,
    accessKey: d.ACCESS_KEY,
    signingSecret: d.SIGNING_SECRET,
    garminKeyExpires: d.GARMIN_KEY_EXPIRES,
    allowedRedirectHosts: d.ALLOWED_REDIRECT_HOSTS?.split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  };
}

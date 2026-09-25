import { z } from "zod";

const EnvSchema = z.object({
  STRIPE_SECRET_KEY: z.string().regex(/^sk_test_/, "Stripe Live keys are not supported"),
  STRIPE_PRO_PRICE_ID: z.string().min(1),
  STRIPE_STARTER_PRICE_ID: z.string().min(1),
  CYCCLE_API_BASE_URL: z.string().url(),
  CYCCLE_API_KEY: z.string().min(1),
  MERIDIAN_SESSION_SECRET: z.string().min(32),
  MERIDIAN_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().default("file:./data/meridian.db"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type MeridianEnv = z.infer<typeof EnvSchema>;

let cachedEnv: MeridianEnv | null = null;

export function env(): MeridianEnv {
  if (!cachedEnv) cachedEnv = EnvSchema.parse(process.env);
  return cachedEnv;
}

export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}

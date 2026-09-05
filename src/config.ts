import { z } from "zod";

const booleanEnv = z.enum(["true", "false"]).default("false").transform((value) => value === "true");

const envSchema = z.object({
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  PUBLIC_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgres://")),
  REDIS_URL: z.string().url().or(z.string().startsWith("redis://")),
  SETUP_TOKEN: z.string().min(16),
  PI_PROVIDER: z.string().min(1).default("anthropic"),
  PI_MODEL: z.string().min(1),
  PI_API_KEY: z.string().min(1),
  PI_THINKING_LEVEL: z.string().default("medium"),
  PI_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  PI_MAX_CONCURRENCY: z.coerce.number().int().positive().default(2),
  ALLOW_AGENT_WRITES: booleanEnv
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return { ...parsed.data, GITHUB_APP_PRIVATE_KEY: parsed.data.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n") };
}

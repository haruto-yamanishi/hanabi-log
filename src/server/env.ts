import "server-only";
import { z } from "zod";

const optional = z.string().trim().optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: optional,
  AUTH_SECRET: optional,
  DEMO_MODE: z.enum(["true", "false"]).optional(),
  SLACK_CLIENT_ID: optional,
  SLACK_CLIENT_SECRET: optional,
  SLACK_TEAM_ID: optional,
  SLACK_BOT_TOKEN: optional,
  SLACK_CHANNEL_ID: optional,
  DATABASE_URL: optional,
  SUPABASE_URL: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  SUPABASE_STORAGE_BUCKET: z.string().default("hanabi-log-private"),
  NOTION_ACCESS_TOKEN: optional,
  NOTION_API_VERSION: z.string().default("2026-03-11"),
  NOTION_DATABASE_ID: z.string().default("212fffe9-1997-4b7c-a631-13629baa8977"),
  NOTION_DATA_SOURCE_ID: z.string().default("aff207bb-2f47-4f19-beba-ae9556bdf442"),
  ADMIN_SLACK_USER_IDS: optional,
  CRON_SECRET: optional,
});

export const env = schema.parse(process.env);

export const isDemoMode =
  env.NODE_ENV !== "production" &&
  (env.DEMO_MODE === "true" || (!env.DEMO_MODE && !env.DATABASE_URL));

export function assertProductionEnv(): void {
  if (env.NODE_ENV !== "production") return;
  const required = [
    "APP_BASE_URL",
    "AUTH_SECRET",
    "SLACK_CLIENT_ID",
    "SLACK_CLIENT_SECRET",
    "SLACK_TEAM_ID",
    "SLACK_BOT_TOKEN",
    "SLACK_CHANNEL_ID",
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NOTION_ACCESS_TOKEN",
    "CRON_SECRET",
  ] as const;
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

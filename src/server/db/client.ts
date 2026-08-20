import "server-only";
import postgres from "postgres";
import { env } from "@/server/env";

const globalDatabase = globalThis as typeof globalThis & {
  __hanabiDatabase?: ReturnType<typeof postgres>;
};

export function getDatabase(): ReturnType<typeof postgres> {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required outside demo mode");
  if (!globalDatabase.__hanabiDatabase) {
    globalDatabase.__hanabiDatabase = postgres(env.DATABASE_URL, {
      max: env.NODE_ENV === "production" ? 10 : 4,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return globalDatabase.__hanabiDatabase;
}

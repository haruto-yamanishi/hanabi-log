import "server-only";
import { isDemoMode } from "@/server/env";
import { MemoryReportRepository } from "@/server/repositories/memory";
import { PostgresReportRepository } from "@/server/repositories/postgres";
import type { OutboxRepository, ReportRepository } from "@/server/repositories/types";

const globalRepositories = globalThis as typeof globalThis & {
  __hanabiReportRepository?: ReportRepository;
};

export function getReportRepository(): ReportRepository {
  globalRepositories.__hanabiReportRepository ??= isDemoMode
    ? new MemoryReportRepository()
    : new PostgresReportRepository();
  return globalRepositories.__hanabiReportRepository;
}

export function getOutboxRepository(): OutboxRepository {
  return getReportRepository();
}

export type {
  ClaimJobsOptions,
  OutboxRepository,
  ReportRepository,
  RetryJobInput,
  SaveNotionBindingInput,
  SaveSlackBindingInput,
} from "@/server/repositories/types";

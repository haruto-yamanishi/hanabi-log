import { RETRY_DELAYS_MS } from "@/lib/constants";
import type {
  IntegrationBinding,
  OutboxJob,
} from "@/lib/types";
import {
  formatPersistedFailure,
  toIntegrationFailure,
  type IntegrationFailure,
} from "@/server/integrations/errors";
import type {
  NotionReportIntegration,
  NotionSyncResult,
} from "@/server/integrations/notion";
import type {
  SlackReportIntegration,
  SlackSyncResult,
} from "@/server/integrations/slack";
import { createSlackIntegration } from "@/server/integrations/slack";
import type { OutboxRepository } from "@/server/repositories/types";

export interface OutboxDependencies {
  repository: OutboxRepository;
  slack: Pick<SlackReportIntegration, "sync">;
  notion: Pick<NotionReportIntegration, "sync" | "refreshProperties">;
  now?: () => Date;
  batchSize?: number;
  notionConcurrency?: number;
}

export interface OutboxProcessSummary {
  claimed: number;
  delivered: number;
  partial: number;
  retryScheduled: number;
  dead: number;
  superseded: number;
  persistenceFailures: number;
  configurationError?: "OUTBOX_NOT_CONFIGURED";
  systemErrorCode?: "OUTBOX_CLAIM_FAILED";
}

export interface RetryDecision {
  attempts: number;
  status: "failed" | "dead";
  availableAt: Date;
}

export interface OutboxProcessor {
  processReportJobs(reportId: string): Promise<OutboxProcessSummary>;
  processPendingJobs(): Promise<OutboxProcessSummary>;
}

type MutableSummary = OutboxProcessSummary;

interface TargetOutcome<T> {
  result?: T;
  failure?: IntegrationFailure;
}

function emptySummary(): MutableSummary {
  return {
    claimed: 0,
    delivered: 0,
    partial: 0,
    retryScheduled: 0,
    dead: 0,
    superseded: 0,
    persistenceFailures: 0,
  };
}

function addSummary(
  total: MutableSummary,
  addition: OutboxProcessSummary,
): void {
  total.delivered += addition.delivered;
  total.partial += addition.partial;
  total.retryScheduled += addition.retryScheduled;
  total.dead += addition.dead;
  total.superseded += addition.superseded;
  total.persistenceFailures += addition.persistenceFailures;
}

export function makeOutboxDedupeKey(
  reportId: string,
  target: OutboxJob["target"],
  action: OutboxJob["action"],
  reportVersion: number,
): string {
  return `${reportId}:${target}:${action}:${reportVersion}`;
}

/**
 * `attempts` is the number of retries already scheduled. The immediate attempt
 * is followed by the four specified retry delays; failure after the fourth
 * retry becomes dead.
 */
export function decideOutboxRetry(
  attempts: number,
  now: Date,
  failure: Pick<IntegrationFailure, "retryable" | "retryAfterMs">,
): RetryDecision {
  const nextAttempts = attempts + 1;
  if (!failure.retryable || attempts >= RETRY_DELAYS_MS.length) {
    return {
      attempts: nextAttempts,
      status: "dead",
      availableAt: now,
    };
  }

  const delay = failure.retryAfterMs ?? RETRY_DELAYS_MS[attempts];
  return {
    attempts: nextAttempts,
    status: "failed",
    availableAt: new Date(now.getTime() + delay),
  };
}

function createLimiter(concurrency: number) {
  const maximum = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    active -= 1;
    queue.shift()?.();
  };

  return async function limit<T>(operation: () => Promise<T>): Promise<T> {
    if (active >= maximum) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

async function capture<T>(
  target: "slack" | "notion",
  operation: () => Promise<T>,
): Promise<TargetOutcome<T>> {
  try {
    return { result: await operation() };
  } catch (error) {
    return { failure: toIntegrationFailure(target, error) };
  }
}

function currentBinding(
  reportId: string,
  original: IntegrationBinding | null,
  slack: TargetOutcome<SlackSyncResult> | undefined,
  notion: TargetOutcome<NotionSyncResult> | undefined,
  updatedAt: string,
): IntegrationBinding {
  return {
    reportId,
    notionPageId: notion?.result?.pageId ?? original?.notionPageId ?? null,
    notionPageUrl: notion?.result?.pageUrl ?? original?.notionPageUrl ?? null,
    notionStatus: notion?.failure
      ? "failed"
      : (notion?.result?.status ?? original?.notionStatus ?? "pending"),
    notionLastError: notion?.failure
      ? formatPersistedFailure(notion.failure)
      : null,
    slackChannelId:
      slack?.result?.channelId ?? original?.slackChannelId ?? null,
    slackMessageTs:
      slack?.result?.messageTs ?? original?.slackMessageTs ?? null,
    slackPermalink:
      slack?.result?.permalink ?? original?.slackPermalink ?? null,
    slackStatus: slack?.failure
      ? "failed"
      : slack?.result?.permalinkFailure
        ? "partial"
      : slack?.result
        ? "delivered"
        : (original?.slackStatus ?? "pending"),
    slackLastError: slack?.failure
      ? formatPersistedFailure(slack.failure)
      : slack?.result?.permalinkFailure
        ? formatPersistedFailure(slack.result.permalinkFailure)
      : null,
    updatedAt,
  };
}

function latestCurrentJob(
  jobs: OutboxJob[],
  reportVersion: number,
): OutboxJob | undefined {
  return jobs
    .filter((job) => job.reportVersion === reportVersion)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function createOutboxProcessor(
  dependencies: OutboxDependencies,
): OutboxProcessor {
  const now = dependencies.now ?? (() => new Date());
  const batchSize = dependencies.batchSize ?? 50;
  const limitNotion = createLimiter(
    Math.min(2, dependencies.notionConcurrency ?? 2),
  );

  const completeSuperseded = async (
    jobs: OutboxJob[],
    completedAt: string,
    summary: MutableSummary,
  ) => {
    const results = await Promise.allSettled(
      jobs.map((job) =>
        dependencies.repository.completeSupersededJob(job.id, {
          completedAt: new Date(completedAt),
        }),
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") summary.superseded += 1;
      else summary.persistenceFailures += 1;
    }
  };

  const persistFailure = async (
    job: OutboxJob,
    failure: IntegrationFailure,
    timestamp: Date,
    summary: MutableSummary,
  ) => {
    const decision = decideOutboxRetry(job.attempts, timestamp, failure);
    await dependencies.repository.retryJob(job.id, {
      attempts: decision.attempts,
      status: decision.status,
      availableAt: decision.availableAt,
      errorCode: formatPersistedFailure(failure),
    });
    if (decision.status === "dead") summary.dead += 1;
    else summary.retryScheduled += 1;
    return decision.status;
  };

  const processGroup = async (jobs: OutboxJob[]): Promise<OutboxProcessSummary> => {
    const summary = emptySummary();
    const timestamp = now();
    const completedAt = timestamp.toISOString();
    const reportId = jobs[0]?.reportId;
    if (!reportId) return summary;

    const [report, binding] = await Promise.all([
      dependencies.repository.getReport(reportId),
      dependencies.repository.getBinding(reportId),
    ]);
    if (!report) {
      await completeSuperseded(jobs, completedAt, summary);
      return summary;
    }

    const slackJobs = jobs.filter((job) => job.target === "slack");
    const notionJobs = jobs.filter((job) => job.target === "notion");
    const slackJob = latestCurrentJob(slackJobs, report.version);
    const notionJob = latestCurrentJob(notionJobs, report.version);
    const superseded = jobs.filter(
      (job) => job.id !== slackJob?.id && job.id !== notionJob?.id,
    );
    await completeSuperseded(superseded, completedAt, summary);

    const [slackOutcome, notionOutcome] = await Promise.all([
      slackJob
        ? capture("slack", () => dependencies.slack.sync(report, binding))
        : Promise.resolve(undefined),
      notionJob
        ? capture("notion", () =>
            limitNotion(() => dependencies.notion.sync(report, binding)),
          )
        : Promise.resolve(undefined),
    ]);

    let finalNotionOutcome = notionOutcome;
    const merged = currentBinding(
      reportId,
      binding,
      slackOutcome,
      notionOutcome,
      completedAt,
    );

    // Slack and Notion initially run in parallel. Patch the resulting Slack
    // delivery state into the already-created Notion page without reposting.
    if (
      slackOutcome &&
      merged.notionPageId &&
      !notionOutcome?.failure
    ) {
      const refreshed = await capture("notion", () =>
        limitNotion(() =>
          dependencies.notion.refreshProperties(
            report,
            merged,
            merged.notionPageId as string,
          ),
        ),
      );
      if (refreshed.failure) {
        finalNotionOutcome = {
          result: notionOutcome?.result,
          failure: refreshed.failure,
        };
      }
    }

    const writes: Array<Promise<void>> = [];

    if (slackJob && slackOutcome) {
      writes.push(
        (async () => {
          if (slackOutcome.failure) {
            const status = await persistFailure(
              slackJob,
              slackOutcome.failure,
              timestamp,
              summary,
            );
            await dependencies.repository.saveSlackBinding(reportId, {
              channelId: binding?.slackChannelId,
              messageTs: binding?.slackMessageTs,
              permalink: binding?.slackPermalink,
              status,
              errorCode: formatPersistedFailure(slackOutcome.failure),
            });
            return;
          }

          const result = slackOutcome.result as SlackSyncResult;
          if (result.permalinkFailure) {
            const decision = decideOutboxRetry(
              slackJob.attempts,
              timestamp,
              result.permalinkFailure,
            );
            await dependencies.repository.retryJob(slackJob.id, {
              attempts: decision.attempts,
              status: decision.status,
              availableAt: decision.availableAt,
              errorCode: formatPersistedFailure(result.permalinkFailure),
            });
            await dependencies.repository.saveSlackBinding(reportId, {
              channelId: result.channelId,
              messageTs: result.messageTs,
              permalink: result.permalink ?? binding?.slackPermalink,
              status: "partial",
              errorCode: formatPersistedFailure(result.permalinkFailure),
            });
            summary.partial += 1;
            if (decision.status === "dead") summary.dead += 1;
            else summary.retryScheduled += 1;
            return;
          }
          await dependencies.repository.saveSlackBinding(reportId, {
            channelId: result.channelId,
            messageTs: result.messageTs,
            permalink: result.permalink,
            status: "delivered",
            errorCode: null,
          });
          await dependencies.repository.completeJob(slackJob.id, {
            completedAt: new Date(completedAt),
          });
          summary.delivered += 1;
        })(),
      );
    }

    if (notionJob && finalNotionOutcome) {
      writes.push(
        (async () => {
          if (finalNotionOutcome.failure) {
            const status = await persistFailure(
              notionJob,
              finalNotionOutcome.failure,
              timestamp,
              summary,
            );
            await dependencies.repository.saveNotionBinding(reportId, {
              pageId:
                finalNotionOutcome.result?.pageId ?? binding?.notionPageId,
              pageUrl:
                finalNotionOutcome.result?.pageUrl ?? binding?.notionPageUrl,
              status,
              errorCode: formatPersistedFailure(finalNotionOutcome.failure),
            });
            return;
          }

          const result = finalNotionOutcome.result as NotionSyncResult;
          if (result.status === "partial" && result.imageFailure) {
            const decision = decideOutboxRetry(
              notionJob.attempts,
              timestamp,
              result.imageFailure,
            );
            await dependencies.repository.retryJob(notionJob.id, {
              attempts: decision.attempts,
              status: decision.status,
              availableAt: decision.availableAt,
              errorCode: formatPersistedFailure(result.imageFailure),
            });
            await dependencies.repository.saveNotionBinding(reportId, {
              pageId: result.pageId,
              pageUrl: result.pageUrl,
              status: "partial",
              errorCode: formatPersistedFailure(result.imageFailure),
            });
            summary.partial += 1;
            if (decision.status === "dead") summary.dead += 1;
            else summary.retryScheduled += 1;
            return;
          }

          await dependencies.repository.saveNotionBinding(reportId, {
            pageId: result.pageId,
            pageUrl: result.pageUrl,
            status: result.status,
            errorCode: null,
          });
          await dependencies.repository.completeJob(notionJob.id, {
            completedAt: new Date(completedAt),
          });
          if (result.status === "partial") summary.partial += 1;
          else summary.delivered += 1;
        })(),
      );
    } else if (!notionJob && finalNotionOutcome?.failure) {
      // A Slack-only attempt can expose a failed Notion property refresh.
      // Persist it and enqueue an independent retry instead of losing it.
      writes.push(
        (async () => {
          const failure = finalNotionOutcome.failure as IntegrationFailure;
          const decision = decideOutboxRetry(0, timestamp, failure);
          await dependencies.repository.saveNotionBinding(reportId, {
            pageId: binding?.notionPageId,
            pageUrl: binding?.notionPageUrl,
            status: decision.status,
            errorCode: formatPersistedFailure(failure),
          });
          summary.partial += 1;
          if (decision.status === "failed") {
            await dependencies.repository.enqueueIntegrationRetry({
              reportId,
              target: "notion",
              action: report.status === "archived" ? "archive" : "update",
              reportVersion: report.version,
              attempts: decision.attempts,
              availableAt: decision.availableAt,
              errorCode: formatPersistedFailure(failure),
            });
            summary.retryScheduled += 1;
          } else {
            summary.dead += 1;
          }
        })(),
      );
    }

    const writeResults = await Promise.allSettled(writes);
    summary.persistenceFailures += writeResults.filter(
      (result) => result.status === "rejected",
    ).length;
    return summary;
  };

  const run = async (reportId?: string): Promise<OutboxProcessSummary> => {
    const total = emptySummary();
    let jobs: OutboxJob[];
    try {
      jobs = await dependencies.repository.claimJobs({
        reportId,
        limit: batchSize,
        now: now(),
      });
    } catch {
      return { ...total, systemErrorCode: "OUTBOX_CLAIM_FAILED" };
    }
    total.claimed = jobs.length;

    const groups = new Map<string, OutboxJob[]>();
    for (const job of jobs) {
      groups.set(job.reportId, [...(groups.get(job.reportId) ?? []), job]);
    }
    const results = await Promise.allSettled(
      [...groups.values()].map((group) => processGroup(group)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") addSummary(total, result.value);
      else total.persistenceFailures += 1;
    }
    return total;
  };

  return {
    processReportJobs: (reportId) => run(reportId),
    processPendingJobs: () => run(),
  };
}

let configuredProcessor: OutboxProcessor | undefined;
let runtimeProcessorPromise: Promise<OutboxProcessor | undefined> | undefined;

/**
 * Never construct real Slack or Notion adapters in demo/test runtimes.
 * Keep this check independent from `server/env` so the pure integration tests
 * can import this module without loading Next.js' `server-only` guard.
 */
export function externalIntegrationsDisabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const demoMode = environment.DEMO_MODE?.trim();
  return (
    demoMode === "true" ||
    environment.NODE_ENV === "test" ||
    (environment.NODE_ENV !== "production" &&
      !demoMode &&
      !environment.DATABASE_URL?.trim())
  );
}

export function configureOutboxProcessor(
  dependencies: OutboxDependencies,
): () => void {
  const processor = createOutboxProcessor(dependencies);
  configuredProcessor = processor;
  return () => {
    if (configuredProcessor === processor) configuredProcessor = undefined;
  };
}

function notConfiguredSummary(): OutboxProcessSummary {
  return {
    ...emptySummary(),
    configurationError: "OUTBOX_NOT_CONFIGURED",
  };
}

async function getRuntimeProcessor(): Promise<OutboxProcessor | undefined> {
  if (configuredProcessor) return configuredProcessor;
  if (externalIntegrationsDisabled()) return undefined;
  runtimeProcessorPromise ??= (async () => {
    const appBaseUrl = process.env.APP_BASE_URL;
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const slackChannelId = process.env.SLACK_CHANNEL_ID;
    if (!appBaseUrl || !slackToken || !slackChannelId) {
      return undefined;
    }

    // Keep the repository import lazy so pure integration tests do not load the
    // Next.js `server-only` runtime module.
    const [
      { getOutboxRepository },
      { createNotionFileDependencies },
      { createOAuthNotionIntegration },
    ] =
      await Promise.all([
        import("@/server/repositories"),
        import("@/server/integrations/notion-files"),
        import("@/server/integrations/notion-oauth"),
      ]);
    return createOutboxProcessor({
      repository: getOutboxRepository(),
      slack: createSlackIntegration({
        token: slackToken,
        channelId: slackChannelId,
        appBaseUrl,
      }),
      notion: createOAuthNotionIntegration({
        appBaseUrl,
        notionVersion: process.env.NOTION_API_VERSION,
        dataSourceId: process.env.NOTION_DATA_SOURCE_ID,
        files: createNotionFileDependencies(),
      }),
    });
  })();
  return runtimeProcessorPromise;
}

/** Called after the report transaction commits. Integration failures never throw. */
export async function processReportJobs(
  reportId: string,
): Promise<OutboxProcessSummary> {
  try {
    const processor = await getRuntimeProcessor();
    if (!processor) return notConfiguredSummary();
    return await processor.processReportJobs(reportId);
  } catch {
    return { ...emptySummary(), systemErrorCode: "OUTBOX_CLAIM_FAILED" };
  }
}

/** Called by Cron/manual retry. Integration failures never throw. */
export async function processPendingJobs(): Promise<OutboxProcessSummary> {
  try {
    const processor = await getRuntimeProcessor();
    if (!processor) return notConfiguredSummary();
    return await processor.processPendingJobs();
  } catch {
    return { ...emptySummary(), systemErrorCode: "OUTBOX_CLAIM_FAILED" };
  }
}

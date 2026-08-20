import "server-only";

import type { IntegrationBinding, Report } from "@/lib/types";
import { deleteReportAttachments } from "@/server/db/storage";
import { env, isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { createOAuthNotionIntegration } from "@/server/integrations/notion-oauth";
import { createSlackIntegration } from "@/server/integrations/slack";

export interface ReportDeletionDependencies {
  slack: { remove(binding: IntegrationBinding | null): Promise<void> };
  notion: { remove(binding: IntegrationBinding | null): Promise<void> };
  attachments: { remove(report: Report): Promise<void> };
}

function productionDependencies(): ReportDeletionDependencies {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID || !env.APP_BASE_URL) {
    throw new AppError(
      "REPORT_DELETE_NOT_CONFIGURED",
      "外部サービスの削除設定が不足しています",
      503,
    );
  }
  return {
    slack: createSlackIntegration({
      token: env.SLACK_BOT_TOKEN,
      channelId: env.SLACK_CHANNEL_ID,
      appBaseUrl: env.APP_BASE_URL,
    }),
    notion: createOAuthNotionIntegration({
      appBaseUrl: env.APP_BASE_URL,
      notionVersion: env.NOTION_API_VERSION,
      dataSourceId: env.NOTION_DATA_SOURCE_ID,
    }),
    attachments: { remove: deleteReportAttachments },
  };
}

const demoDependencies: ReportDeletionDependencies = {
  slack: { remove: async () => undefined },
  notion: { remove: async () => undefined },
  attachments: { remove: deleteReportAttachments },
};

/**
 * Removes provider-owned resources before the database row is deleted.
 * Each operation is idempotent so a partially completed deletion can be retried.
 */
export async function deleteReportResources(
  report: Report,
  dependencies: ReportDeletionDependencies = isDemoMode
    ? demoDependencies
    : productionDependencies(),
): Promise<void> {
  const binding = report.integration ?? null;
  try {
    if (binding?.slackChannelId && binding.slackMessageTs) {
      await dependencies.slack.remove(binding);
    }
  } catch {
    throw new AppError(
      "SLACK_DELETE_ERROR",
      "Slackの投稿を削除できませんでした。時間をおいてもう一度お試しください",
      502,
    );
  }

  try {
    if (binding?.notionPageId) {
      await dependencies.notion.remove(binding);
    }
  } catch {
    throw new AppError(
      "NOTION_DELETE_ERROR",
      "Notionページをゴミ箱へ移動できませんでした。Notion接続を確認してください",
      502,
    );
  }

  await dependencies.attachments.remove(report);
}

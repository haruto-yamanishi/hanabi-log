import { WebClient } from "@slack/web-api";

import type { IntegrationBinding, Report } from "@/lib/types";
import {
  IntegrationError,
  toIntegrationFailure,
  type IntegrationFailure,
} from "@/server/integrations/errors";

export type SlackBlock = Record<string, unknown>;

export interface SlackMessagePayload {
  text: string;
  blocks: SlackBlock[];
}

export interface SlackPostMessageInput extends SlackMessagePayload {
  channel: string;
}

export interface SlackUpdateMessageInput extends SlackMessagePayload {
  channel: string;
  ts: string;
}

export interface SlackDeleteMessageInput {
  channel: string;
  ts: string;
}

export interface SlackApiPort {
  postMessage(input: SlackPostMessageInput): Promise<{
    channel: string;
    ts: string;
  }>;
  updateMessage(input: SlackUpdateMessageInput): Promise<void>;
  deleteMessage(input: SlackDeleteMessageInput): Promise<void>;
  getPermalink(input: { channel: string; messageTs: string }): Promise<string>;
  getReplyCount(input: { channel: string; messageTs: string }): Promise<number>;
}

export interface SlackSyncResult {
  channelId: string;
  messageTs: string;
  permalink: string | null;
  operation: "posted" | "updated";
  permalinkFailure?: IntegrationFailure;
}

export interface SlackReportIntegration {
  sync(report: Report, binding: IntegrationBinding | null): Promise<SlackSyncResult>;
  remove(binding: IntegrationBinding | null): Promise<void>;
}

const ACTIVITY_EMOJI: Record<Report["activityArea"], string> = {
  ロボット: "🤖",
  アワード: "🏆",
  アウトリーチ: "🤝",
  ブランディング: "🎨",
  チーム運営: "🧭",
  "資金調達・スポンサー": "💴",
  その他: "📝",
};

function escapeMrkdwn(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function reportUrl(appBaseUrl: string, reportId: string): string {
  const base = new URL(appBaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, "")}/reports/${encodeURIComponent(reportId)}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function authorAttribution(report: Report): string {
  const slackUserId = report.author.slackUserId?.trim();
  const author =
    slackUserId && /^[UW][A-Z0-9]+$/.test(slackUserId)
      ? `<@${slackUserId}>`
      : escapeMrkdwn(report.author.displayName);
  return `Written by ${author}`;
}

export function renderSlackReport(
  report: Report,
  appBaseUrl: string,
): SlackMessagePayload {
  const archived = report.status === "archived";
  const titlePrefix = archived ? "[アーカイブ] " : "";
  const visibleTitle = `${titlePrefix}${report.title}`;
  const headerTitle = `${ACTIVITY_EMOJI[report.activityArea]} ${visibleTitle}`;
  const byline = authorAttribution(report);
  const fallbackText = `${escapeMrkdwn(
    `[${report.activityArea}] ${visibleTitle}`,
  )}\n${byline}`;
  const summary = escapeMrkdwn(report.summary || report.activityText.slice(0, 100));
  const context = [
    report.activityArea,
    report.contentCategory,
    report.reportDate.replaceAll("-", "."),
  ]
    .map(escapeMrkdwn)
    .join(" · ");

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: headerTitle.slice(0, 150),
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: byline }],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: summary },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: context }],
    },
  ];

  if (!archived) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "日報を読む", emoji: true },
          style: "primary",
          url: reportUrl(appBaseUrl, report.id),
          action_id: "open_report",
        },
      ],
    });
  }

  return { text: fallbackText, blocks };
}

export class SlackReportService implements SlackReportIntegration {
  constructor(
    private readonly api: SlackApiPort,
    private readonly channelId: string,
    private readonly appBaseUrl: string,
  ) {}

  async sync(
    report: Report,
    binding: IntegrationBinding | null,
  ): Promise<SlackSyncResult> {
    const message = renderSlackReport(report, this.appBaseUrl);
    const existingChannel = binding?.slackChannelId ?? this.channelId;
    const existingTs = binding?.slackMessageTs;

    if (existingTs) {
      await this.api.updateMessage({
        channel: existingChannel,
        ts: existingTs,
        ...message,
      });
      return this.resolvePermalink({
        channelId: existingChannel,
        messageTs: existingTs,
        operation: "updated",
        fallbackPermalink: binding?.slackPermalink,
      });
    }

    const posted = await this.api.postMessage({
      channel: this.channelId,
      ...message,
    });
    return this.resolvePermalink({
      channelId: posted.channel,
      messageTs: posted.ts,
      operation: "posted",
    });
  }

  async remove(binding: IntegrationBinding | null): Promise<void> {
    if (!binding?.slackChannelId || !binding.slackMessageTs) return;
    await this.api.deleteMessage({
      channel: binding.slackChannelId,
      ts: binding.slackMessageTs,
    });
  }

  private async resolvePermalink(input: {
    channelId: string;
    messageTs: string;
    operation: SlackSyncResult["operation"];
    fallbackPermalink?: string | null;
  }): Promise<SlackSyncResult> {
    try {
      const permalink = await this.api.getPermalink({
        channel: input.channelId,
        messageTs: input.messageTs,
      });
      return { ...input, permalink };
    } catch (error) {
      // The message itself has already been posted or updated. Return its IDs so
      // the retry updates that exact message instead of posting a duplicate.
      if (input.fallbackPermalink) {
        return { ...input, permalink: input.fallbackPermalink };
      }
      return {
        ...input,
        permalink: null,
        permalinkFailure: toIntegrationFailure("slack", error),
      };
    }
  }
}

export class SlackWebApiAdapter implements SlackApiPort {
  private nextChannelWriteAt = 0;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly client: WebClient) {}

  static fromToken(token: string): SlackWebApiAdapter {
    return new SlackWebApiAdapter(
      new WebClient(token, {
        retryConfig: { retries: 0 },
        rejectRateLimitedCalls: true,
        timeout: 10_000,
      }),
    );
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(async () => {
      const waitMs = Math.max(0, this.nextChannelWriteAt - Date.now());
      if (waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
      this.nextChannelWriteAt = Date.now() + 1_000;
      return operation();
    });
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async postMessage(
    input: SlackPostMessageInput,
  ): Promise<{ channel: string; ts: string }> {
    return this.enqueueWrite(async () => {
      const result = await this.client.chat.postMessage(input);
      if (!result.channel || !result.ts) {
        throw new IntegrationError("RESPONSE_MISSING_MESSAGE_ID", {
          retryable: true,
        });
      }
      return { channel: result.channel, ts: result.ts };
    });
  }

  async updateMessage(input: SlackUpdateMessageInput): Promise<void> {
    await this.enqueueWrite(async () => {
      await this.client.chat.update(input);
    });
  }

  async deleteMessage(input: SlackDeleteMessageInput): Promise<void> {
    try {
      await this.enqueueWrite(async () => {
        await this.client.chat.delete(input);
      });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "data" in error &&
        typeof error.data === "object" && error.data !== null && "error" in error.data
          ? error.data.error
          : undefined;
      if (code === "message_not_found") return;
      throw error;
    }
  }

  async getPermalink(input: {
    channel: string;
    messageTs: string;
  }): Promise<string> {
    const result = await this.client.chat.getPermalink({
      channel: input.channel,
      message_ts: input.messageTs,
    });
    if (!result.permalink) {
      throw new IntegrationError("RESPONSE_MISSING_PERMALINK", {
        retryable: true,
      });
    }
    return result.permalink;
  }

  async getReplyCount(input: {
    channel: string;
    messageTs: string;
  }): Promise<number> {
    const result = await this.client.conversations.replies({
      channel: input.channel,
      ts: input.messageTs,
      limit: 15,
    });
    const root = result.messages?.[0] as { reply_count?: number } | undefined;
    return root?.reply_count ?? 0;
  }
}

export function createSlackIntegration(input: {
  token: string;
  channelId: string;
  appBaseUrl: string;
}): SlackReportIntegration {
  return new SlackReportService(
    SlackWebApiAdapter.fromToken(input.token),
    input.channelId,
    input.appBaseUrl,
  );
}

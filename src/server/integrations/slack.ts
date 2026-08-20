import { WebClient, type ChatPostMessageArguments } from "@slack/web-api";

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
  threadTs?: string;
  metadata?: {
    eventType: string;
    eventPayload: Record<string, string>;
  };
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
  followupFailure?: IntegrationFailure;
}

export interface SlackReportIntegration {
  sync(report: Report, binding: IntegrationBinding | null): Promise<SlackSyncResult>;
  remove(binding: IntegrationBinding | null): Promise<void>;
}

export type PrepareSlackReport = (report: Report) => Promise<Report>;
export const SLACK_FULL_REPORT_EVENT_TYPE = "hanabi_log_full_report";

const ACTIVITY_EMOJI: Record<Report["activityArea"], string> = {
  ロボット: "🤖",
  アワード: "🏆",
  アウトリーチ: "🤝",
  ブランディング: "🎨",
  ファンドレイジング: "💴",
  事務局: "🧭",
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

function splitSlackText(value: string, maximum = 2_800): string[] {
  const chunks: string[] = [];
  let rest = value.trim();
  while (rest.length > maximum) {
    const newline = rest.lastIndexOf("\n", maximum);
    const splitAt = newline > maximum / 2 ? newline : maximum;
    chunks.push(rest.slice(0, splitAt));
    rest = rest.slice(splitAt).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function needsFullSlackThread(report: Report): boolean {
  return report.activityText.trim() !== report.summary.trim()
    || Boolean(report.learningText.trim())
    || Boolean(report.issueText.trim())
    || Boolean(report.nextActionText.trim());
}

export function renderSlackFullReport(report: Report): SlackMessagePayload {
  const sections = [
    ["今日やったこと", report.activityText],
    ["判断・学び", report.learningText],
    ["課題・相談", report.issueText],
    ["次のアクション", report.nextActionText],
  ].filter((entry) => entry[1].trim());
  const blocks: SlackBlock[] = [];
  for (const [label, body] of sections) {
    splitSlackText(body).forEach((chunk, index) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${index === 0 ? `*${label}*\n` : ""}${escapeMrkdwn(chunk)}`,
        },
      });
    });
  }
  return {
    text: `日報全文: ${report.title}`,
    blocks,
  };
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

  const links = [...report.relatedLinks]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((link) => {
      const label = escapeMrkdwn(link.label).replaceAll("|", "¦");
      return `• <${escapeMrkdwn(link.url)}|${label}>`;
    });
  if (links.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*関連リンク*\n${links.join("\n")}`,
      },
    });
  }

  const visibleAttachments = [...report.attachments]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .filter((attachment) => attachment.signedUrl)
    .slice(0, 10);
  for (const attachment of visibleAttachments) {
    blocks.push({
      type: "image",
      image_url: attachment.signedUrl,
      alt_text: (attachment.altText || attachment.filename || "日報の添付画像").slice(0, 2_000),
      title: {
        type: "plain_text",
        text: attachment.filename.slice(0, 2_000),
        emoji: true,
      },
    });
  }
  if (report.attachments.length > visibleAttachments.length) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `ほか ${report.attachments.length - visibleAttachments.length} 件の画像は日報ページで確認できます。`,
      }],
    });
  }

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
    private readonly prepareReport?: PrepareSlackReport,
  ) {}

  async sync(
    report: Report,
    binding: IntegrationBinding | null,
  ): Promise<SlackSyncResult> {
    const preparedReport = this.prepareReport
      ? await this.prepareReport(report)
      : report;
    const message = renderSlackReport(preparedReport, this.appBaseUrl);
    const existingChannel = binding?.slackChannelId ?? this.channelId;
    const existingTs = binding?.slackMessageTs;

    if (existingTs) {
      await this.api.updateMessage({
        channel: existingChannel,
        ts: existingTs,
        ...message,
      });
      const retryFullThread = binding?.slackStatus === "partial"
        && binding.slackLastError?.includes("SLACK_FULL_REPORT_THREAD_FAILED")
        && needsFullSlackThread(preparedReport);
      const followupFailure = retryFullThread
        ? await this.postFullReportThread(preparedReport, existingChannel, existingTs)
        : undefined;
      return this.resolvePermalink({
        channelId: existingChannel,
        messageTs: existingTs,
        operation: "updated",
        fallbackPermalink: binding?.slackPermalink,
        followupFailure,
      });
    }

    const posted = await this.api.postMessage({
      channel: this.channelId,
      ...message,
    });
    const followupFailure = needsFullSlackThread(preparedReport)
      ? await this.postFullReportThread(preparedReport, posted.channel, posted.ts)
      : undefined;
    return this.resolvePermalink({
      channelId: posted.channel,
      messageTs: posted.ts,
      operation: "posted",
      followupFailure,
    });
  }

  private async postFullReportThread(
    report: Report,
    channel: string,
    threadTs: string,
  ): Promise<IntegrationFailure | undefined> {
    try {
      await this.api.postMessage({
        channel,
        threadTs,
        metadata: {
          eventType: SLACK_FULL_REPORT_EVENT_TYPE,
          eventPayload: { report_id: report.id },
        },
        ...renderSlackFullReport(report),
      });
      return undefined;
    } catch (error) {
      const failure = toIntegrationFailure("slack", error);
      return {
        ...failure,
        code: "SLACK_FULL_REPORT_THREAD_FAILED",
      };
    }
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
    followupFailure?: IntegrationFailure;
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
      const payload = {
        channel: input.channel,
        text: input.text,
        blocks: input.blocks,
        thread_ts: input.threadTs,
        metadata: input.metadata
          ? {
              event_type: input.metadata.eventType,
              event_payload: input.metadata.eventPayload,
            }
          : undefined,
      } as ChatPostMessageArguments;
      const result = await this.client.chat.postMessage(payload);
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
  prepareReport?: PrepareSlackReport;
}): SlackReportIntegration {
  return new SlackReportService(
    SlackWebApiAdapter.fromToken(input.token),
    input.channelId,
    input.appBaseUrl,
    input.prepareReport,
  );
}

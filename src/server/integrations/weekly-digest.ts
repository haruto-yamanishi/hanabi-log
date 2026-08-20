import type { Report } from "@/lib/types";
import type { SlackApiPort, SlackMessagePayload } from "@/server/integrations/slack";
import type { ReportRepository } from "@/server/repositories/types";

type WeeklyDigestRepository = Pick<
  ReportRepository,
  | "listWeeklyBestReports"
  | "claimWeeklyDigest"
  | "completeWeeklyDigest"
  | "failWeeklyDigest"
>;

const JST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export interface WeeklyPeriod {
  start: Date;
  end: Date;
  startDate: string;
  endDate: string;
}

export interface WeeklyDigestResult {
  status: "delivered" | "already_delivered" | "processing" | "empty";
  reportCount: number;
}

function escapeMrkdwn(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function reportUrl(appBaseUrl: string, reportId: string): string {
  const url = new URL(appBaseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/reports/${encodeURIComponent(reportId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function authorLabel(report: Report): string {
  const slackUserId = report.author.slackUserId?.trim();
  return slackUserId && /^[UW][A-Z0-9]+$/.test(slackUserId)
    ? `<@${slackUserId}>`
    : escapeMrkdwn(report.author.displayName);
}

export function previousJstWeek(now: Date): WeeklyPeriod {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const daysSinceMonday = (jst.getUTCDay() + 6) % 7;
  const currentMondayAsUtc = Date.UTC(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate() - daysSinceMonday,
  );
  const end = new Date(currentMondayAsUtc - JST_OFFSET_MS);
  const start = new Date(end.getTime() - 7 * DAY_MS);

  const dateInJst = (value: Date) =>
    new Date(value.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  return {
    start,
    end,
    startDate: dateInJst(start),
    endDate: dateInJst(end),
  };
}

function shortDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export function renderWeeklyDigest(
  reports: Report[],
  period: WeeklyPeriod,
  appBaseUrl: string,
): SlackMessagePayload {
  const periodLabel = `${shortDate(period.startDate)}〜${shortDate(
    new Date(period.end.getTime() - DAY_MS + JST_OFFSET_MS).toISOString().slice(0, 10),
  )}`;
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🔥 先週のベスト日報", emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `${periodLabel} · いいね数で選ばれた2件です` }],
    },
    { type: "divider" },
  ];

  reports.forEach((report, index) => {
    const summary = escapeMrkdwn(report.summary || report.activityText.slice(0, 100));
    const conversationUrl = report.integration?.slackPermalink || reportUrl(appBaseUrl, report.id);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${index + 1}. ${escapeMrkdwn(report.title)}*\n${summary}\n${authorLabel(report)} · :heart: ${report.likeCount ?? 0}`,
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: report.integration?.slackPermalink ? "Slackで話す" : "日報を読む",
          emoji: true,
        },
        url: conversationUrl,
        action_id: `open_weekly_report_${index + 1}`,
      },
    });
  });

  return {
    text: `先週のベスト日報: ${reports.map((report) => report.title).join(" / ")}`,
    blocks,
  };
}

function errorCode(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function deliverWeeklyDigest(input: {
  repository: WeeklyDigestRepository;
  slack: Pick<SlackApiPort, "postMessage">;
  tokenChannelId: string;
  appBaseUrl: string;
  now?: Date;
}): Promise<WeeklyDigestResult> {
  const period = previousJstWeek(input.now ?? new Date());
  const reports = await input.repository.listWeeklyBestReports({
    periodStart: period.start,
    periodEnd: period.end,
    limit: 2,
  });
  if (!reports.length) return { status: "empty", reportCount: 0 };

  const delivery = {
    periodStart: period.startDate,
    periodEnd: period.endDate,
    channelId: input.tokenChannelId,
  };
  const claim = await input.repository.claimWeeklyDigest(delivery);
  if (claim === "delivered") {
    return { status: "already_delivered", reportCount: reports.length };
  }
  if (claim === "processing") {
    return { status: "processing", reportCount: reports.length };
  }

  try {
    const posted = await input.slack.postMessage({
      channel: input.tokenChannelId,
      ...renderWeeklyDigest(reports, period, input.appBaseUrl),
    });
    await input.repository.completeWeeklyDigest({ ...delivery, messageTs: posted.ts });
    return { status: "delivered", reportCount: reports.length };
  } catch (error) {
    await input.repository.failWeeklyDigest({ ...delivery, errorCode: errorCode(error) });
    throw error;
  }
}

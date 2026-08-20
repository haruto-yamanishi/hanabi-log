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

export interface WeeklyHighlights {
  bestPost: Report;
  bestDiscussion: { report: Report; replyCount: number } | null;
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

function dateInJst(value: Date): string {
  return new Date(value.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Current Monday 00:00 through the following Monday 00:00 in JST. */
export function currentJstWeek(now: Date): WeeklyPeriod {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const daysSinceMonday = (jst.getUTCDay() + 6) % 7;
  const mondayAsUtc = Date.UTC(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate() - daysSinceMonday,
  );
  const start = new Date(mondayAsUtc - JST_OFFSET_MS);
  const end = new Date(start.getTime() + 7 * DAY_MS);
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

function reportSection(input: {
  label: string;
  metric: string;
  report: Report;
  appBaseUrl: string;
  actionId: string;
}): Record<string, unknown> {
  const summary = escapeMrkdwn(input.report.summary || input.report.activityText.slice(0, 100));
  const conversationUrl =
    input.report.integration?.slackPermalink || reportUrl(input.appBaseUrl, input.report.id);
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${input.label}（${input.metric}）*\n*${escapeMrkdwn(input.report.title)}*\n${summary}\n${authorLabel(input.report)}`,
    },
    accessory: {
      type: "button",
      text: {
        type: "plain_text",
        text: input.report.integration?.slackPermalink ? "Slackで話す" : "日報を読む",
        emoji: true,
      },
      url: conversationUrl,
      action_id: input.actionId,
    },
  };
}

export function renderWeeklyDigest(
  highlights: WeeklyHighlights,
  period: WeeklyPeriod,
  appBaseUrl: string,
): SlackMessagePayload {
  const lastDay = dateInJst(new Date(period.end.getTime() - DAY_MS));
  const periodLabel = `${shortDate(period.startDate)}〜${shortDate(lastDay)}`;
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🏅 今週のHANABI LOG", emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `${periodLabel}の活動を振り返ります` }],
    },
    { type: "divider" },
    reportSection({
      label: "❤️ ベスト投稿",
      metric: `いいね ${highlights.bestPost.likeCount ?? 0}件`,
      report: highlights.bestPost,
      appBaseUrl,
      actionId: "open_weekly_best_post",
    }),
  ];

  if (highlights.bestPost.likedBy?.length) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `いいねした人: ${highlights.bestPost.likedBy
          .map((member) => escapeMrkdwn(member.displayName))
          .join("、")}`,
      }],
    });
  }

  blocks.push({ type: "divider" });
  if (highlights.bestDiscussion) {
    blocks.push(reportSection({
      label: "💬 ベストディスカッション",
      metric: `返信 ${highlights.bestDiscussion.replyCount}件`,
      report: highlights.bestDiscussion.report,
      appBaseUrl,
      actionId: "open_weekly_best_discussion",
    }));
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*💬 ベストディスカッション*\n今週はまだスレッドへの返信がありません。" },
    });
  }

  return {
    text: `今週のHANABI LOG: ${highlights.bestPost.title}`,
    blocks,
  };
}

function errorCode(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function findBestDiscussion(
  reports: Report[],
  slack: Pick<SlackApiPort, "getReplyCount">,
): Promise<WeeklyHighlights["bestDiscussion"]> {
  let best: WeeklyHighlights["bestDiscussion"] = null;
  for (const report of reports) {
    const channel = report.integration?.slackChannelId;
    const messageTs = report.integration?.slackMessageTs;
    if (!channel || !messageTs) continue;
    const replyCount = await slack.getReplyCount({ channel, messageTs });
    if (replyCount > 0 && (!best || replyCount > best.replyCount)) {
      best = { report, replyCount };
    }
  }
  return best;
}

export async function deliverWeeklyDigest(input: {
  repository: WeeklyDigestRepository;
  slack: Pick<SlackApiPort, "postMessage" | "getReplyCount">;
  tokenChannelId: string;
  appBaseUrl: string;
  now?: Date;
}): Promise<WeeklyDigestResult> {
  const period = currentJstWeek(input.now ?? new Date());
  const reports = await input.repository.listWeeklyBestReports({
    periodStart: period.start,
    periodEnd: period.end,
    limit: 50,
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
    const highlights: WeeklyHighlights = {
      bestPost: reports[0],
      bestDiscussion: await findBestDiscussion(reports, input.slack),
    };
    const posted = await input.slack.postMessage({
      channel: input.tokenChannelId,
      ...renderWeeklyDigest(highlights, period, input.appBaseUrl),
    });
    await input.repository.completeWeeklyDigest({ ...delivery, messageTs: posted.ts });
    return { status: "delivered", reportCount: reports.length };
  } catch (error) {
    await input.repository.failWeeklyDigest({ ...delivery, errorCode: errorCode(error) });
    throw error;
  }
}

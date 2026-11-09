import { WebClient } from "@slack/web-api";

import type {
  CurrentUser,
  Member,
  ReportComment,
  ReportCommentAuthor,
} from "@/lib/types";
import { IntegrationError } from "@/server/integrations/errors";
import { SLACK_FULL_REPORT_EVENT_TYPE } from "@/server/integrations/slack";

const WEB_COMMENT_EVENT = "hanabi_log_web_comment";


export interface SlackThreadReply {
  ts: string;
  text: string;
  userId?: string;
  botName?: string;
  files?: { id?: string; name?: string; mimetype?: string }[];
  blocks?: unknown[];
  metadata?: {
    eventType?: string;
    eventPayload?: Record<string, unknown>;
  };
}

export interface SlackUserProfile {
  slackUserId: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface SlackCommentApiPort {
  listReplies(input: { channel: string; threadTs: string }): Promise<SlackThreadReply[]>;
  postReply(input: {
    channel: string;
    threadTs: string;
    actor: CurrentUser;
    body: string;
  }): Promise<{ ts: string }>;
  getUserProfile(slackUserId: string): Promise<SlackUserProfile | null>;
}

function timestampToIso(ts: string): string {
  const seconds = Number(ts.split(".", 1)[0]);
  if (!Number.isFinite(seconds)) return new Date(0).toISOString();
  return new Date(seconds * 1_000).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function webCommentBody(reply: SlackThreadReply): string | null {
  if (reply.metadata?.eventType !== WEB_COMMENT_EVENT) return null;
  for (const block of reply.blocks ?? []) {
    const record = asRecord(block);
    if (record?.type !== "section") continue;
    const text = asRecord(record.text);
    if (text?.type === "plain_text" && typeof text.text === "string") {
      return text.text.trim();
    }
  }
  const separator = reply.text.indexOf("\n");
  return (separator >= 0 ? reply.text.slice(separator + 1) : reply.text).trim();
}

function metadataString(reply: SlackThreadReply, key: string): string | undefined {
  const value = reply.metadata?.eventPayload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSlackText(
  text: string,
  memberBySlackId: Map<string, Member>,
  profiles: Map<string, SlackUserProfile>,
): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)>/g, (_match, id: string) => {
      const name = memberBySlackId.get(id)?.displayName || profiles.get(id)?.displayName;
      return name ? `@${name}` : "@Slackメンバー";
    })
    .replace(/<(https?:\/\/[^>|]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}

export class SlackCommentService {
  constructor(private readonly api: SlackCommentApiPort) {}

  async list(input: {
    channel: string;
    threadTs: string;
    members: Member[];
  }): Promise<ReportComment[]> {
    const replies = (await this.api.listReplies(input)).filter(reply => !(reply.text === "日報の添付動画（Hanabi Log）"
      && reply.files?.length && reply.files.every(file => /^hanabi-log-[0-9a-f-]{36}-[0-9a-f]{16}\.(mp4|webm|mov)$/.test(file.name ?? ""))));
    const memberById = new Map(input.members.map((member) => [member.id, member]));
    const memberBySlackId = new Map(
      input.members.map((member) => [member.slackUserId, member]),
    );
    const unresolvedIds = new Set<string>();
    for (const reply of replies) {
      if (reply.metadata?.eventType === WEB_COMMENT_EVENT || reply.metadata?.eventType === SLACK_FULL_REPORT_EVENT_TYPE) continue;
      if (reply.userId && !memberBySlackId.has(reply.userId)) {
        unresolvedIds.add(reply.userId);
      }
      for (const match of reply.text.matchAll(/<@([UW][A-Z0-9]+)>/g)) {
        const mentionedId = match[1];
        if (mentionedId && !memberBySlackId.has(mentionedId)) unresolvedIds.add(mentionedId);
      }
    }
    const profiles = new Map<string, SlackUserProfile>();
    const resolved = await Promise.allSettled(
      [...unresolvedIds].map((id) => this.api.getUserProfile(id)),
    );
    [...unresolvedIds].forEach((id, index) => {
      const result = resolved[index];
      if (result?.status === "fulfilled" && result.value) profiles.set(id, result.value);
    });

    return replies.flatMap((reply): ReportComment[] => {
      if (reply.metadata?.eventType === SLACK_FULL_REPORT_EVENT_TYPE) return [];
      const fromWeb = reply.metadata?.eventType === WEB_COMMENT_EVENT;
      const body = fromWeb
        ? webCommentBody(reply)
        : normalizeSlackText(reply.text, memberBySlackId, profiles);
      const attachments = (reply.files ?? []).flatMap(file => file.id && /^(image|video)\//.test(file.mimetype ?? "") ? [{ id: file.id, filename: file.name || "添付ファイル", mimeType: file.mimetype! }] : []);
      if (!body && !attachments.length) return [];

      let author: ReportCommentAuthor;
      if (fromWeb) {
        const memberId = metadataString(reply, "member_id");
        const member = memberId ? memberById.get(memberId) : undefined;
        author = member
          ? { id: member.id, displayName: member.displayName, avatarUrl: member.avatarUrl ?? null }
          : {
              displayName: metadataString(reply, "display_name") || "WEBアプリのメンバー",
              avatarUrl: null,
            };
      } else {
        const member = reply.userId ? memberBySlackId.get(reply.userId) : undefined;
        const profile = reply.userId ? profiles.get(reply.userId) : undefined;
        author = member
          ? { id: member.id, displayName: member.displayName, avatarUrl: member.avatarUrl ?? null }
          : profile
            ? { displayName: profile.displayName, avatarUrl: profile.avatarUrl ?? null, slackUserId: profile.slackUserId }
            : { displayName: reply.botName || "Slackメンバー", avatarUrl: null, ...(reply.userId ? { slackUserId: reply.userId } : {}) };
      }

      return [{
        id: reply.ts,
        ...(attachments.length ? { attachments } : {}),
        body: body || "",
        createdAt: timestampToIso(reply.ts),
        source: fromWeb ? "web" : "slack",
        author,
      }];
    }).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );
  }

  async post(input: {
    channel: string;
    threadTs: string;
    actor: CurrentUser;
    body: string;
  }): Promise<ReportComment> {
    const posted = await this.api.postReply(input);
    return {
      id: posted.ts,
      body: input.body,
      createdAt: timestampToIso(posted.ts),
      source: "web",
      author: {
        id: input.actor.id,
        displayName: input.actor.displayName,
        avatarUrl: input.actor.avatarUrl ?? null,
      },
    };
  }
}

interface SlackMessageRecord {
  ts?: string;
  text?: string;
  user?: string;
  bot_profile?: { name?: string };
  files?: { id?: string; name?: string; mimetype?: string }[];
  blocks?: unknown[];
  metadata?: { event_type?: string; event_payload?: Record<string, unknown> };
}

export class SlackWebCommentAdapter implements SlackCommentApiPort {
  constructor(private readonly client: WebClient) {}

  static fromToken(token: string): SlackWebCommentAdapter {
    return new SlackWebCommentAdapter(new WebClient(token, {
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
      timeout: 10_000,
    }));
  }

  async listReplies(input: { channel: string; threadTs: string }): Promise<SlackThreadReply[]> {
    const replies: SlackThreadReply[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.client.conversations.replies({
        channel: input.channel,
        ts: input.threadTs,
        cursor,
        limit: 100,
        include_all_metadata: true,
      });
      for (const raw of (result.messages ?? []).slice(cursor ? 0 : 1)) {
        const message = raw as SlackMessageRecord;
        if (!message.ts) continue;
        replies.push({
          ts: message.ts,
          text: message.text ?? "",
          userId: message.user,
          botName: message.bot_profile?.name,
          blocks: message.blocks,
          files: message.files,
          metadata: message.metadata
            ? {
                eventType: message.metadata.event_type,
                eventPayload: message.metadata.event_payload,
              }
            : undefined,
        });

      }
      cursor = result.response_metadata?.next_cursor || undefined;
      if (result.has_more && !cursor) throw new IntegrationError("SLACK_REPLIES_INCOMPLETE", { retryable: true });
    } while (cursor);
    return replies;
  }

  async postReply(input: {
    channel: string;
    threadTs: string;
    actor: CurrentUser;
    body: string;
  }): Promise<{ ts: string }> {
    const result = await this.client.chat.postMessage({
      channel: input.channel,
      thread_ts: input.threadTs,
      text: `${input.actor.displayName}（WEBアプリから）\n${input.body}`,
      mrkdwn: false,
      unfurl_links: false,
      unfurl_media: false,
      metadata: {
        event_type: WEB_COMMENT_EVENT,
        event_payload: {
          member_id: input.actor.id,
          slack_user_id: input.actor.slackUserId,
          display_name: input.actor.displayName,
        },
      },
      blocks: [
        {
          type: "context",
          elements: [{
            type: "mrkdwn",
            text: `WEBアプリから投稿 • <@${input.actor.slackUserId}>`,
          }],
        },
        {
          type: "section",
          text: { type: "plain_text", text: input.body, emoji: true },
        },
      ],
    });
    if (!result.ts) {
      throw new IntegrationError("RESPONSE_MISSING_MESSAGE_ID", { retryable: true });
    }
    return { ts: result.ts };
  }

  async getUserProfile(slackUserId: string): Promise<SlackUserProfile | null> {
    const result = await this.client.users.info({ user: slackUserId });
    const user = result.user;
    if (!user) return null;
    const displayName = user.profile?.display_name || user.real_name || user.name;
    if (!displayName) return null;
    return {
      slackUserId,
      displayName,
      avatarUrl: user.profile?.image_72 || user.profile?.image_48 || null,
    };
  }
}

export function createSlackCommentService(token: string): SlackCommentService {
  return new SlackCommentService(SlackWebCommentAdapter.fromToken(token));
}

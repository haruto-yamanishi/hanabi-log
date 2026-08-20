import type {
  Attachment,
  IntegrationBinding,
  Member,
  OutboxJob,
  RelatedLink,
  Report,
} from "@/lib/types";

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export interface MemberRow {
  id: string;
  slack_team_id: string;
  slack_user_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  role: Member["role"];
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ReportRow {
  id: string;
  author_id: string;
  report_date: Date | string;
  title: string;
  summary: string | null;
  activity_area: Report["activityArea"];
  content_category: Report["contentCategory"];
  activity_text: string;
  learning_text: string | null;
  issue_text: string | null;
  next_action_text: string | null;
  theme_tags: Report["themeTags"];
  status: Report["status"];
  version: number;
  published_at: Date | string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  author_slack_user_id: string;
  author_display_name: string;
  author_avatar_url: string | null;
}

export interface RelatedLinkRow {
  id: string;
  report_id: string;
  label: string;
  url: string;
  sort_order: number;
}

export interface AttachmentRow {
  id: string;
  report_id: string;
  storage_path: string;
  filename: string;
  mime_type: Attachment["mimeType"];
  size_bytes: number;
  alt_text: string | null;
  sort_order: number;
}

export interface IntegrationBindingRow {
  report_id: string;
  notion_page_id: string | null;
  notion_page_url: string | null;
  notion_status: IntegrationBinding["notionStatus"];
  notion_last_error: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_permalink: string | null;
  slack_status: IntegrationBinding["slackStatus"];
  slack_last_error: string | null;
  updated_at: Date | string;
}

export interface OutboxJobRow {
  id: string;
  report_id: string;
  target: OutboxJob["target"];
  action: OutboxJob["action"];
  report_version: number;
  dedupe_key: string;
  status: OutboxJob["status"];
  attempts: number;
  available_at: Date | string;
  locked_at: Date | string | null;
  last_error: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
}

export function mapMember(row: MemberRow): Member {
  return {
    id: row.id,
    slackTeamId: row.slack_team_id,
    slackUserId: row.slack_user_id,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    role: row.role,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function mapReport(
  row: ReportRow,
  relatedLinks: RelatedLink[] = [],
  attachments: Attachment[] = [],
  integration: IntegrationBinding | null = null,
): Report {
  return {
    id: row.id,
    authorId: row.author_id,
    author: {
      id: row.author_id,
      slackUserId: row.author_slack_user_id,
      displayName: row.author_display_name,
      avatarUrl: row.author_avatar_url,
    },
    reportDate: dateOnly(row.report_date),
    title: row.title,
    summary: row.summary ?? "",
    activityArea: row.activity_area,
    contentCategory: row.content_category,
    activityText: row.activity_text,
    learningText: row.learning_text ?? "",
    issueText: row.issue_text ?? "",
    nextActionText: row.next_action_text ?? "",
    themeTags: row.theme_tags,
    status: row.status,
    version: row.version,
    publishedAt: row.published_at ? iso(row.published_at) : null,
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    relatedLinks,
    attachments,
    integration,
  };
}

export function mapRelatedLink(row: RelatedLinkRow): RelatedLink {
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    sortOrder: row.sort_order,
  };
}

export function mapAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    storagePath: row.storage_path,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    altText: row.alt_text,
    sortOrder: row.sort_order,
  };
}

export function mapIntegrationBinding(row: IntegrationBindingRow): IntegrationBinding {
  return {
    reportId: row.report_id,
    notionPageId: row.notion_page_id,
    notionPageUrl: row.notion_page_url,
    notionStatus: row.notion_status,
    notionLastError: row.notion_last_error,
    slackChannelId: row.slack_channel_id,
    slackMessageTs: row.slack_message_ts,
    slackPermalink: row.slack_permalink,
    slackStatus: row.slack_status,
    slackLastError: row.slack_last_error,
    updatedAt: iso(row.updated_at),
  };
}

export function mapOutboxJob(row: OutboxJobRow): OutboxJob {
  return {
    id: row.id,
    reportId: row.report_id,
    target: row.target,
    action: row.action,
    reportVersion: row.report_version,
    dedupeKey: row.dedupe_key,
    status: row.status,
    attempts: row.attempts,
    availableAt: iso(row.available_at),
    lockedAt: row.locked_at ? iso(row.locked_at) : null,
    lastError: row.last_error,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    createdAt: iso(row.created_at),
  };
}

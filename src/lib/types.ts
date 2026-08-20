import type {
  ActivityArea,
  ContentCategory,
  DeliveryStatus,
  DeliveryTarget,
  ReportStatus,
  ThemeTag,
} from "@/lib/constants";

export type MemberRole = "member" | "admin";

export interface Member {
  id: string;
  slackTeamId: string;
  slackUserId: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
  role: MemberRole;
  createdAt: string;
  updatedAt: string;
}

/**
 * Member data that is safe to return from authenticated API endpoints.
 * Slack workspace identifiers and email addresses intentionally stay server-side.
 */
export interface PublicMember {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  role: MemberRole;
}

export interface ReportAuthor {
  id: string;
  /** Server-side integration identifier. Removed from browser-facing DTOs. */
  slackUserId?: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface RelatedLink {
  id?: string;
  label: string;
  url: string;
  sortOrder: number;
}

export interface Attachment {
  id?: string;
  storagePath: string;
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  altText?: string | null;
  sortOrder: number;
  signedUrl?: string;
}

export interface IntegrationBinding {
  reportId: string;
  notionPageId?: string | null;
  notionPageUrl?: string | null;
  notionStatus: DeliveryStatus;
  notionLastError?: string | null;
  slackChannelId?: string | null;
  slackMessageTs?: string | null;
  slackPermalink?: string | null;
  slackStatus: DeliveryStatus;
  slackLastError?: string | null;
  updatedAt: string;
}

export interface Report {
  id: string;
  authorId: string;
  author: ReportAuthor;
  reportDate: string;
  title: string;
  summary: string;
  activityArea: ActivityArea;
  contentCategory: ContentCategory;
  activityText: string;
  learningText: string;
  issueText: string;
  nextActionText: string;
  themeTags: ThemeTag[];
  status: ReportStatus;
  version: number;
  publishedAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  relatedLinks: RelatedLink[];
  attachments: Attachment[];
  integration?: IntegrationBinding | null;
  likeCount?: number;
  likedByCurrentUser?: boolean;
}

export interface ReportLikeSummary {
  likeCount: number;
  liked: boolean;
}

export interface ReportInput {
  reportDate: string;
  title: string;
  summary?: string;
  activityArea: ActivityArea;
  contentCategory: ContentCategory;
  activityText: string;
  learningText?: string;
  issueText?: string;
  nextActionText?: string;
  themeTags?: ThemeTag[];
  relatedLinks?: RelatedLink[];
  attachments?: Attachment[];
}

export interface ReportFilters {
  q?: string;
  activityArea?: ActivityArea;
  contentCategory?: ContentCategory;
  themeTag?: ThemeTag;
  authorId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: ReportStatus;
  cursor?: string;
  limit?: number;
}

export interface ReportPage {
  reports: Report[];
  nextCursor: string | null;
}

export interface OutboxJob {
  id: string;
  reportId: string;
  target: DeliveryTarget;
  action: "publish" | "update" | "archive" | "restore";
  reportVersion: number;
  dedupeKey: string;
  status: DeliveryStatus;
  attempts: number;
  availableAt: string;
  lockedAt?: string | null;
  lastError?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

export interface CurrentUser {
  id: string;
  slackUserId: string;
  displayName: string;
  role: MemberRole;
  avatarUrl?: string | null;
}

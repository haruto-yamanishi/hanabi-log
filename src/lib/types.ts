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
  isActive: boolean;
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
  isActive: boolean;
}

export interface ReportAuthor {
  id: string;
  /** Server-side integration identifier. Removed from browser-facing DTOs. */
  slackUserId?: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface ReportLiker {
  id: string;
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
  likedBy?: ReportLiker[];
}

/** Fields returned by report list endpoints. Full content and attachments are loaded on detail pages. */
export interface ReportListItem {
  id: string;
  authorId: string;
  author: ReportAuthor;
  reportDate: string;
  title: string;
  summary: string;
  activityArea: ActivityArea;
  contentCategory: ContentCategory;
  themeTags: ThemeTag[];
  status: ReportStatus;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  integration?: IntegrationBinding | null;
  likeCount?: number;
  likedByCurrentUser?: boolean;
  likedBy?: ReportLiker[];
  /** Kept optional so existing clients can progressively move from the former full list DTO. */
  activityText?: string;
  learningText?: string;
  issueText?: string;
  nextActionText?: string;
  version?: number;
  archivedAt?: string | null;
  relatedLinks?: RelatedLink[];
  attachments?: Attachment[];
}

export interface ReportLikeSummary {
  likeCount: number;
  liked: boolean;
  likedBy: ReportLiker[];
}

export interface ReportCommentAuthor {
  id?: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface ReportComment {
  id: string;
  body: string;
  createdAt: string;
  source: "slack" | "web";
  author: ReportCommentAuthor;
}

export interface ReportCommentsResult {
  available: boolean;
  comments: ReportComment[];
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
  reports: ReportListItem[];
  nextCursor: string | null;
}

export interface ContributionDay {
  date: string;
  count: number;
}

export interface ContributionSummary {
  total: number;
  days: ContributionDay[];
}

export interface LogRanking {
  rank: number;
  memberCount: number;
  score: number;
  publishedReports: number;
  likesReceived: number;
  commentsReceived: number;
  commentsMade: number;
  currentStreak: number;
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
  isActive: boolean;
  avatarUrl?: string | null;
}

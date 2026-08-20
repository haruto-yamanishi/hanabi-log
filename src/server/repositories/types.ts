import type { DeliveryStatus, DeliveryTarget } from "@/lib/constants";
import type {
  CurrentUser,
  IntegrationBinding,
  Member,
  OutboxJob,
  Report,
  ReportFilters,
  ReportInput,
  ReportLikeSummary,
  ReportPage,
} from "@/lib/types";

export interface MemberUpsertInput {
  slackTeamId: string;
  slackUserId: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
  role: Member["role"];
}

export interface ClaimJobsOptions {
  reportId?: string;
  limit: number;
  now: Date;
}

export interface SaveSlackBindingInput {
  channelId?: string | null;
  messageTs?: string | null;
  permalink?: string | null;
  status: DeliveryStatus;
  errorCode?: string | null;
}

export interface SaveNotionBindingInput {
  pageId?: string | null;
  pageUrl?: string | null;
  status: DeliveryStatus;
  errorCode?: string | null;
}

export interface RetryJobInput {
  attempts: number;
  status: "failed" | "dead";
  availableAt: Date;
  errorCode: string;
}

export interface EnqueueIntegrationRetryInput {
  reportId: string;
  target: DeliveryTarget;
  action: OutboxJob["action"];
  reportVersion: number;
  attempts: number;
  availableAt: Date;
  errorCode: string;
}

export interface WeeklyBestInput {
  periodStart: Date;
  periodEnd: Date;
  limit: number;
}

export interface WeeklyDigestDeliveryInput {
  periodStart: string;
  periodEnd: string;
  channelId: string;
}

export type DeleteMemberResult = "deleted" | "not_found" | "has_reports";

export interface OutboxRepository {
  claimJobs(options: ClaimJobsOptions): Promise<OutboxJob[]>;
  getReport(reportId: string): Promise<Report | null>;
  getBinding(reportId: string): Promise<IntegrationBinding | null>;
  saveSlackBinding(reportId: string, input: SaveSlackBindingInput): Promise<void>;
  saveNotionBinding(reportId: string, input: SaveNotionBindingInput): Promise<void>;
  completeJob(jobId: string, input: { completedAt: Date }): Promise<void>;
  retryJob(jobId: string, input: RetryJobInput): Promise<void>;
  enqueueIntegrationRetry(input: EnqueueIntegrationRetryInput): Promise<void>;
  completeSupersededJob(jobId: string, input: { completedAt: Date }): Promise<void>;
}

export interface ReportRepository extends OutboxRepository {
  upsertMember(input: MemberUpsertInput): Promise<Member>;
  getMember(memberId: string): Promise<Member | null>;
  listMembers(): Promise<Member[]>;
  setMemberRole(memberId: string, role: Member["role"]): Promise<Member | null>;
  setMemberActivity(memberId: string, isActive: boolean): Promise<Member | null>;
  deleteMember(memberId: string): Promise<DeleteMemberResult>;
  listReports(filters: ReportFilters, actor: CurrentUser): Promise<ReportPage>;
  getReadableReport(reportId: string, actor: CurrentUser): Promise<Report | null>;
  setReportLike(
    reportId: string,
    actor: CurrentUser,
    liked: boolean,
  ): Promise<ReportLikeSummary>;
  listWeeklyBestReports(input: WeeklyBestInput): Promise<Report[]>;
  claimWeeklyDigest(input: WeeklyDigestDeliveryInput): Promise<"claimed" | "delivered" | "processing">;
  completeWeeklyDigest(input: WeeklyDigestDeliveryInput & { messageTs: string }): Promise<void>;
  failWeeklyDigest(input: WeeklyDigestDeliveryInput & { errorCode: string }): Promise<void>;
  createDraft(
    actor: CurrentUser,
    input: ReportInput,
    idempotencyKey?: string,
  ): Promise<Report>;
  patchReport(
    reportId: string,
    actor: CurrentUser,
    expectedVersion: number,
    input: ReportInput,
  ): Promise<Report>;
  publishReport(
    reportId: string,
    actor: CurrentUser,
    idempotencyKey?: string,
  ): Promise<Report>;
  approveReport(reportId: string, actor: CurrentUser): Promise<Report>;
  archiveReport(reportId: string, actor: CurrentUser): Promise<Report>;
  restoreReport(reportId: string, actor: CurrentUser): Promise<Report>;
  deleteReport(reportId: string, actor: CurrentUser): Promise<void>;
  requestIntegrationRetry(
    reportId: string,
    target: DeliveryTarget,
    actor: CurrentUser,
  ): Promise<Report>;
}

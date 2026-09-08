export interface LikeNotificationHistory {
  kind: "report" | "member";
  memberId: string;
  reportId: string | null;
  reportTitle: string | null;
  recipientName: string;
  recipientSlackUserId: string;
  recipientRecorded: boolean;
  thresholds: number[];
  messageText: string | null;
  sentAt: string | null;
  attemptedAt: string | null;
  status: "sent" | "failed" | "processing" | "pending";
  error: string | null;
}

export interface SystemDmHistory {
  id: string;
  kind: "like" | "contribution_nudge" | "announcement" | "publication";
  reportId: string | null;
  reportTitle: string | null;
  recipientName: string;
  recipientSlackUserId: string;
  recipientRecorded: boolean;
  messageText: string | null;
  sentAt: string | null;
  attemptedAt: string | null;
  status: "sent" | "failed" | "processing" | "pending" | "unknown";
  error: string | null;
}

/** Decode Slack's three supported entities without treating message text as HTML. */
export function slackDisplayText(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

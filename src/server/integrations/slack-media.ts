import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Report } from "@/lib/types";
import { env } from "@/server/env";

export function slackMediaToken(id: string, storagePath: string): string {
  if (!env.SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY required");
  return createHmac("sha256", env.SUPABASE_SECRET_KEY).update(`slack-image:v1:${id}:${storagePath}`).digest("hex");
}

export function validSlackMediaToken(id: string, storagePath: string, token: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(slackMediaToken(id, storagePath), "hex"));
}

// These capability URLs remain usable by Slack, but only while the attachment
// belongs to a published report. Deleting/archiving a report revokes access.
export async function prepareSlackAttachments(report: Report, origin: string): Promise<Report> {
  return { ...report, attachments: report.attachments.map(attachment => ({
    ...attachment,
    signedUrl: attachment.id ? `${origin}/api/slack-media/${attachment.id}?token=${slackMediaToken(attachment.id, attachment.storagePath)}` : undefined,
  })) };
}

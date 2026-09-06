import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function verifySlackSignature(body: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): boolean {
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`);
  const supplied = Buffer.from(signature);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const messageSchema = z.object({
  type: z.literal("message"), channel: z.string().min(1), user: z.string().min(1),
  ts: z.string().regex(/^\d+\.\d+$/), text: z.string().trim().min(1),
  subtype: z.string().optional(), bot_id: z.string().optional(), thread_ts: z.string().optional(),
});

export function incomingSlackMessage(event: unknown, channelId: string) {
  const parsed = messageSchema.safeParse(event);
  if (!parsed.success) return null;
  const message = parsed.data;
  if (message.channel !== channelId || message.bot_id ||
      (message.subtype && message.subtype !== "file_share") ||
      (message.thread_ts && message.thread_ts !== message.ts)) return null;
  return message;
}

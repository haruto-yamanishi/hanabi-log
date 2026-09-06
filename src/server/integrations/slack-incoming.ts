import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function verifySlackSignature(body: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): boolean {
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`);
  const supplied = Buffer.from(signature);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const timestampSchema = z.string().regex(/^\d+\.\d+$/);

const messageSchema = z.object({
  type: z.literal("message"), channel: z.string().min(1), user: z.string().min(1),
  ts: timestampSchema, edited: z.object({ ts: timestampSchema }).optional(), text: z.string().trim().min(1),
  subtype: z.string().optional(), bot_id: z.string().optional(), thread_ts: z.string().optional(),
});

export function incomingSlackMessage(event: unknown, channelId: string) {
  const change = z.object({
    type: z.literal("message"), subtype: z.literal("message_changed"),
    channel: z.string(), message: z.record(z.string(), z.unknown()),
  }).safeParse(event);
  const parsed = messageSchema.safeParse(change.success
    ? { ...change.data.message, channel: change.data.channel }
    : event);
  if (!parsed.success) return null;
  const message = parsed.data;
  if (message.channel !== channelId || message.bot_id ||
      (message.subtype && message.subtype !== "file_share") ||
      (message.thread_ts && message.thread_ts !== message.ts)) return null;
  if (change.success && !message.edited) return null;
  return { ...message, eventTs: message.edited?.ts ?? message.ts, changed: change.success };
}


export function incomingSlackReaction(event: unknown, channelId: string) {
  const parsed = z.object({
    type: z.enum(["reaction_added", "reaction_removed"]),
    user: z.string().min(1), reaction: z.string().min(1), event_ts: timestampSchema,
    item: z.object({ type: z.literal("message"), channel: z.string(), ts: timestampSchema }),
  }).safeParse(event);
  return parsed.success && parsed.data.item.channel === channelId ? parsed.data : null;
}

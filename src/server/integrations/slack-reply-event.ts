// Message edits/deletions carry thread metadata on the nested message.
export function replyThread(event: unknown, channel: string): string | null {
  if (!event || typeof event !== "object") return null;
  const value = event as Record<string, unknown>;
  if (value.type !== "message" || value.channel !== channel) return null;
  const nested = value.subtype === "message_deleted" ? value.previous_message : value.subtype === "message_changed" ? value.message : value;
  if (!nested || typeof nested !== "object") return null;
  const message = nested as Record<string, unknown>;
  return typeof message.thread_ts === "string" && /^\d+\.\d+$/.test(message.thread_ts) && message.thread_ts !== message.ts ? message.thread_ts : null;
}

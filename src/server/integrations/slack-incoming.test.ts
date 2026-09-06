import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { incomingSlackMessage, incomingSlackReaction, verifySlackSignature } from "./slack-incoming";

const message = { type: "message", channel: "C_REPORTS", user: "U_MEMBER", ts: "1788735600.000001", text: "今日は配線を進めました。" };

describe("Slack incoming reports", () => {
  it("accepts plain text and text with files only in the report channel", () => {
    expect(incomingSlackMessage(message, message.channel)?.text).toBe(message.text);
    expect(incomingSlackMessage({ ...message, subtype: "file_share" }, message.channel)).not.toBeNull();
    for (const changes of [{ channel: "C_OTHER" }, { bot_id: "B_APP" }, { subtype: "message_changed" }, { thread_ts: "1788735500.000001" }, { text: "  " }]) {
      expect(incomingSlackMessage({ ...message, ...changes }, message.channel)).toBeNull();
    }
  });
  it("rejects tampered and expired requests", () => {
    const body = JSON.stringify(message);
    const timestamp = "1788735600";
    const signature = `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
    const now = Number(timestamp) * 1000;
    expect(verifySlackSignature(body, timestamp, signature, "secret", now)).toBe(true);
    expect(verifySlackSignature(body + " ", timestamp, signature, "secret", now)).toBe(false);
    expect(verifySlackSignature(body, timestamp, signature, "secret", now + 301000)).toBe(false);
    expect(verifySlackSignature(body, timestamp, "bad", "secret", now)).toBe(false);
  });
});


it("uses the original message ID and edit timestamp for edited human posts", () => {
  const event = { type: "message", subtype: "message_changed", channel: message.channel,
    message: { ...message, text: "編集後", edited: { ts: "1788735700.000001" } } };
  expect(incomingSlackMessage(event, message.channel)).toMatchObject({
    ts: message.ts, text: "編集後", eventTs: "1788735700.000001", changed: true,
  });
  expect(incomingSlackMessage({ ...event, message: { ...event.message, bot_id: "B_APP" } }, message.channel)).toBeNull();
});

it("accepts reaction additions and removals only on channel messages", () => {
  const event = { type: "reaction_added", user: "U_MEMBER", reaction: "heart", event_ts: "1788735700.000001",
    item: { type: "message", channel: message.channel, ts: message.ts } };
  expect(incomingSlackReaction(event, message.channel)?.reaction).toBe("heart");
  expect(incomingSlackReaction({ ...event, type: "reaction_removed" }, message.channel)?.type).toBe("reaction_removed");
  expect(incomingSlackReaction(event, "C_OTHER")).toBeNull();
  expect(incomingSlackReaction({ ...event, item: { type: "file", file: "F1" } }, message.channel)).toBeNull();
});

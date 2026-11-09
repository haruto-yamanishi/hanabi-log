import { expect, it } from "vitest";
import { replyThread } from "./slack-reply-event";
it("indexes new replies, edits and deletions but ignores parents and other channels", () => {
  const message = { ts: "100.2", thread_ts: "100.1" };
  const base = { type: "message", channel: "C1" };
  expect(replyThread({ ...base, ...message }, "C1")).toBe("100.1");
  expect(replyThread({ ...base, subtype: "message_changed", message }, "C1")).toBe("100.1");
  expect(replyThread({ ...base, subtype: "message_deleted", previous_message: message }, "C1")).toBe("100.1");
  expect(replyThread({ ...base, ...message }, "C2")).toBeNull();
  expect(replyThread({ ...base, ...message, ts: "100.1" }, "C1")).toBeNull();
  expect(replyThread({ ...base, thread_ts: "oops" }, "C1")).toBeNull();
});

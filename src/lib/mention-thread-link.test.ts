import { expect, it } from "vitest";
import { appendMentionThreadLink, mentionThreadLink } from "./mention-thread-link";
it("uses the bound report's parent thread, with or without a stored permalink", () => {
  expect(mentionThreadLink("C123", "123.456", "https://team.slack.com/archives/C123/p123456"))
    .toBe("https://team.slack.com/archives/C123/p123456?thread_ts=123.456&cid=C123");
  expect(mentionThreadLink("G123", "123.456")).toContain("/archives/G123/p123456?thread_ts=123.456&cid=G123");
  expect(()=>mentionThreadLink("C123","invalid")).toThrow();
});
it("keeps the Web link, guides non-members and does not append twice", () => {
  const link = mentionThreadLink("C123", "123.456");
  const text = appendMentionThreadLink("<https://hanabi.test/reports/1|日報を読む>",link);
  expect(text).toContain("https://hanabi.test/reports/1");
  expect(text).toContain("Slackで日報のスレッドを開く");
  expect(text).toContain("チャンネルに参加するか");
  expect(appendMentionThreadLink(text,link)).toBe(text);
});

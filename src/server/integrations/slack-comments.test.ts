import { describe, expect, it, vi } from "vitest";

import type { CurrentUser, Member } from "@/lib/types";
import {
  SlackCommentService,
  type SlackCommentApiPort,
} from "@/server/integrations/slack-comments";

const actor: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U123ABC",
  displayName: "山西遥斗",
  avatarUrl: "https://example.test/avatar.png",
  role: "member",
  isActive: true,
};
const member: Member = {
  ...actor,
  slackTeamId: "T_TEAM",
  email: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

function api(): SlackCommentApiPort {
  return {
    listReplies: vi.fn(async () => []),
    postReply: vi.fn(async () => ({ ts: "1787200100.000200" })),
    getUserProfile: vi.fn(async (slackUserId) => ({
      slackUserId,
      displayName: "Slackだけのメンバー",
      avatarUrl: null,
    })),
  };
}

describe("SlackCommentService", () => {
  it("merges direct Slack replies and attributed WEB replies", async () => {
    const client = api();
    vi.mocked(client.listReplies).mockResolvedValue([
      {
        ts: "1787200001.000100",
        text: "Slackからのコメント <@U123ABC>",
        userId: "U123ABC",
      },
      {
        ts: "1787200002.000200",
        text: "山西遥斗（WEBアプリから）\nWEBからのコメント",
        blocks: [
          { type: "context", elements: [] },
          { type: "section", text: { type: "plain_text", text: "WEBからのコメント" } },
        ],
        metadata: {
          eventType: "hanabi_log_web_comment",
          eventPayload: {
            member_id: actor.id,
            display_name: actor.displayName,
          },
        },
      },
    ]);
    const service = new SlackCommentService(client);

    const comments = await service.list({
      channel: "C_REPORTS",
      threadTs: "1787200000.000000",
      members: [member],
    });

    expect(comments).toEqual([
      expect.objectContaining({
        id: "1787200002.000200",
        body: "WEBからのコメント",
        source: "web",
        author: expect.objectContaining({ id: actor.id, displayName: actor.displayName }),
      }),
      expect.objectContaining({
        id: "1787200001.000100",
        body: "Slackからのコメント @山西遥斗",
        source: "slack",
        author: expect.objectContaining({ id: actor.id, displayName: actor.displayName }),
      }),
    ]);
    expect(client.getUserProfile).not.toHaveBeenCalled();
  });

  it("resolves a Slack-only commenter profile", async () => {
    const client = api();
    vi.mocked(client.listReplies).mockResolvedValue([{
      ts: "1787200001.000100",
      text: "まだWEBへログインしていない人",
      userId: "U_SLACK_ONLY",
    }]);
    const service = new SlackCommentService(client);

    const comments = await service.list({
      channel: "C_REPORTS",
      threadTs: "1787200000.000000",
      members: [member],
    });

    expect(client.getUserProfile).toHaveBeenCalledWith("U_SLACK_ONLY");
    expect(comments[0]?.author.displayName).toBe("Slackだけのメンバー");
  });

  it("returns the posted WEB comment without another Slack read", async () => {
    const client = api();
    const service = new SlackCommentService(client);

    const comment = await service.post({
      channel: "C_REPORTS",
      threadTs: "1787200000.000000",
      actor,
      body: "確認しました",
    });

    expect(client.postReply).toHaveBeenCalledWith({
      channel: "C_REPORTS",
      threadTs: "1787200000.000000",
      actor,
      body: "確認しました",
    });
    expect(comment).toMatchObject({
      body: "確認しました",
      source: "web",
      author: { id: actor.id, displayName: actor.displayName },
    });
    expect(client.listReplies).not.toHaveBeenCalled();
  });
});

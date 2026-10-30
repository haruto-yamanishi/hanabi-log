import type { MentionDirectory, MentionUser } from "@/lib/mention-editor";
import { WebClient } from "@slack/web-api";
import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { env } from "@/server/env";
import { enforceRateLimit } from "@/server/rate-limit";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    await enforceRateLimit(request, actor.id, "read");
    if (!env.SLACK_BOT_TOKEN) return Response.json([]);
    const client = new WebClient(env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, timeout: 10000 });
    const users: MentionUser[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.users.list({ limit: 200, cursor });
      for (const user of page.members ?? []) {
        if (user.id && !user.deleted && !user.is_bot && user.id !== "USLACKBOT") {
          users.push({ kind: "user", id: user.id, name: user.profile?.display_name || user.real_name || user.name || user.id, realName: user.profile?.real_name || user.real_name || "", username: user.name || "" });
        }
      }
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    let groupStatus: MentionDirectory["groupStatus"] = "available";
    try {
      const groups = await client.usergroups.list({ include_count: true, include_disabled: false });
      for (const group of groups.usergroups ?? []) {
        if (!group.id || group.date_delete || !group.handle) continue;
        users.push({ id: group.id, kind: "group", name: group.name || group.handle, username: group.handle, memberCount: Number(group.user_count) || 0 });
      }
    } catch (error) {
      const code = (error as { data?: { error?: string } }).data?.error;
      groupStatus = code === "missing_scope" ? "missing_scope" : code === "plan_upgrade_required" ? "unsupported" : "unavailable";
    }
    return Response.json({ members: users, groupStatus } satisfies MentionDirectory, { headers: { "Cache-Control": `private, max-age=${groupStatus === "available" ? 300 : 0}` } });
  });
}

import "server-only";
import type { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";
import { env } from "@/server/env";

/** Request-scoped cache: no stale names or cross-workspace global state. */
export function createSlackMentionResolver(client: Pick<WebClient, "users" | "usergroups">) {
  const cache = new Map<string, Promise<string | null>>();
  let groups: Promise<Map<string, string>> | undefined;
  const resolve = (id: string): Promise<string | null> => {
    if (!cache.has(id)) cache.set(id, (async () => {
      if (id.startsWith("S")) {
        groups ??= client.usergroups.list({ include_disabled: true }).then(result => new Map(
          (result.usergroups ?? []).flatMap(group => group.id && (group.name || group.handle)
            ? [[group.id, group.name || group.handle!]] : []),
        ));
        return (await groups).get(id) ?? null;
      }
      const sql = getDatabase();
      const [member] = await sql`select display_name from members
        where slack_team_id=${env.SLACK_TEAM_ID ?? ""} and slack_user_id=${id}`;
      if (member?.display_name?.trim() && member.display_name !== id) return member.display_name;
      const { user } = await client.users.info({ user: id });
      return user?.profile?.display_name?.trim() || user?.real_name?.trim() || user?.name?.trim() || null;
    })().catch(() => null));
    return cache.get(id)!;
  };
  return resolve;
}

/** Keep IDs in editable tokens while displaying actual names in the app. */
export async function normalizeImportedMentions(text: string, resolve: (id: string) => Promise<string | null>) {
  const pattern = /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>|<!subteam\^(S[A-Z0-9]+)(?:\|([^>]+))?>/g;
  const names = new Map<string, string | null>();
  for (const match of text.matchAll(pattern)) {
    const id = match[1] || match[3];
    if (!names.has(id)) names.set(id, await resolve(id));
  }
  return text.replace(pattern, (original, userId: string, userLabel: string, groupId: string, groupLabel: string) => {
    const id = userId || groupId;
    const name = names.get(id) || userLabel || groupLabel;
    if (!name) return original; // Keep identity intact if Slack cannot resolve it.
    const label = name.replace(/^@/, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")
      .replace(/[\[\]\r\n]/g, " ").trim();
    return label ? `@[${label}](slack:${id})` : original;
  });
}

import "server-only";
import { WebClient } from "@slack/web-api";
import { z, ZodError } from "zod";
import { after } from "next/server";
import { PUBLICATION_STATUS } from "@/lib/publication";
import { PUBLICATION_SLACK_ACTION, PUBLICATION_SLACK_MORE, PUBLICATION_SLACK_VIEW, publicationActionFromModal, publicationButtonSchema, publicationInfoModal, publicationModal, publicationModalSchema } from "@/lib/publication-slack";
import type { CurrentUser } from "@/lib/types";
import { getDatabase } from "@/server/db/client";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { actOnPublication, getPublication, processPublicationNotifications } from "@/server/publication";

const valuesSchema = z.record(z.string(), z.record(z.string(), z.object({ value: z.string().nullable().optional() }).passthrough()));
export const interactionSchema = z.object({
  type: z.enum(["block_actions", "view_submission"]),
  team: z.object({ id: z.string() }), user: z.object({ id: z.string() }),
  trigger_id: z.string().optional(),
  actions: z.array(z.object({ action_id: z.string(), value: z.string().optional() })).optional(),
  view: z.object({ id: z.string(), hash: z.string().optional(), callback_id: z.string().optional(), private_metadata: z.string().optional(), state: z.object({ values: valuesSchema }).optional() }).optional(),
});
type Interaction = z.infer<typeof interactionSchema>;
async function slackActor(payload: Interaction): Promise<CurrentUser> {
  const sql = getDatabase();
  const [member] = await sql`select id, slack_user_id, display_name, role, is_active from members
    where slack_team_id = ${payload.team.id} and slack_user_id = ${payload.user.id}`;
  if (!member) throw new AppError("FORBIDDEN", "Hanabi Logに登録されている本人のSlackアカウントから操作してください", 403);
  return { id: member.id, slackUserId: member.slack_user_id, displayName: member.display_name, role: member.role, isActive: member.is_active };
}
function message(error: unknown) {
  return error instanceof AppError ? error.message : "処理を完了できませんでした。DMのボタンからもう一度お試しください。";
}
export async function handlePublicationInteraction(payload: Interaction): Promise<Response> {
  const client = new WebClient(env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 2000 });
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (!action || ![PUBLICATION_SLACK_ACTION, PUBLICATION_SLACK_MORE].includes(action.action_id)) return new Response(null);
    let selection: z.infer<typeof publicationButtonSchema> & { version?: number; bodyParts?: number };
    try {
      selection = action.action_id === PUBLICATION_SLACK_MORE
        ? publicationModalSchema.parse(JSON.parse(payload.view?.private_metadata ?? ""))
        : publicationButtonSchema.parse(JSON.parse(action.value ?? ""));
    } catch { return new Response(null, { status: 400 }); }
    // Exchange the short-lived trigger before doing database work.
    let viewId = payload.view?.id;
    let hash = payload.view?.hash;
    if (!viewId) {
      if (!payload.trigger_id) return new Response(null, { status: 400 });
      try {
        const opened = await client.views.open({ trigger_id: payload.trigger_id, view: publicationInfoModal("掲載依頼を読み込んでいます…") });
        viewId = opened.view?.id; hash = opened.view?.hash;
      } catch { return new Response(null, { status: 502 }); }
    }
    if (!viewId) return new Response(null, { status: 502 });
    const id = viewId;
    after(async () => {
      let view;
      try {
        const actor = await slackActor(payload);
        const item = await getPublication(selection.id, actor);
        if (action.action_id === PUBLICATION_SLACK_MORE && selection.version !== undefined && selection.version !== item.version) {
          throw new AppError("CONFLICT", "この依頼は更新されています。入力内容を控えてからDMのボタンを開き直してください", 409);
        }
        view = publicationModal(item, actor, selection.intent, selection.bodyParts !== undefined ? selection.bodyParts + 1 : 1);
      } catch (error) { view = publicationInfoModal(message(error)); }
      try { await client.views.update({ view_id: id, ...(hash ? { hash } : {}), view }); }
      catch { console.error("Could not update publication Slack modal"); }
    });
    return new Response(null);
  }
  if (payload.view?.callback_id !== PUBLICATION_SLACK_VIEW) return new Response(null);
  const values = payload.view.state?.values ?? {};
  try {
    const metadata = publicationModalSchema.parse(JSON.parse(payload.view.private_metadata ?? ""));
    const action = publicationActionFromModal(metadata, values);
    const actor = await slackActor(payload);
    const result = await actOnPublication(metadata.id, actor, action);
    after(async () => {
      try { await processPublicationNotifications(); }
      catch { console.error("Publication notifications retained for retry"); }
    });
    return Response.json({ response_action: "update", view: publicationInfoModal(`送信しました。\n「${result.title}」\n状態：${PUBLICATION_STATUS[result.status]}\n相手へSlack DMで通知します。Webにも同じ内容が反映されています。`) });
  } catch (error) {
    const errors: Record<string, string> = {};
    if (error instanceof ZodError) {
      for (const issue of error.issues) {
        const key = issue.path[0] === "body" ? "body_0" : issue.path[0] === "url" ? "url" : "note_0";
        if (Object.hasOwn(values, key)) errors[key] = issue.message;
      }
    }
    const firstInput = Object.keys(values)[0];
    if (!Object.keys(errors).length && firstInput) errors[firstInput] = message(error);
    if (Object.keys(errors).length) return Response.json({ response_action: "errors", errors });
    return Response.json({ response_action: "update", view: publicationInfoModal(message(error)) });
  }
}

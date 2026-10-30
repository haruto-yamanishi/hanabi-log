import "server-only";
import { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";
import { getReportRepository } from "@/server/repositories";
import { AppError } from "@/server/errors";
import { sendSystemDm } from "@/server/integrations/system-dm";
import type { CurrentUser, Report } from "@/lib/types";
import { canRequestPublication, DECISIONS, PUBLICATION_STATUS, reportPublicationText, transitionPublication, PublicationTransitionError, type PublicationRequest, type PublicationAction, type publicationCreateSchema } from "@/lib/publication";
import type { z } from "zod";
import { publicationButton } from "@/lib/publication-slack";

const demo = globalThis as typeof globalThis & { __hanabiPublications?: Map<string, PublicationRequest> };
const demoRequests = () => demo.__hanabiPublications ??= new Map();
const visible = (request: PublicationRequest, actor: CurrentUser) => actor.role === "admin" || request.authorId === actor.id || request.requesterId === actor.id;
export async function listPublications(actor: CurrentUser, reportId?: string): Promise<PublicationRequest[]> {
  if (isDemoMode) return [...demoRequests().values()].filter(item => visible(item,actor) && (!reportId || item.reportId === reportId)).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const sql = getDatabase();
  const rows = await sql`select payload from publication_requests where (${actor.role === "admin"} or author_id=${actor.id} or requester_id=${actor.id})
    ${reportId ? sql`and report_id=${reportId}` : sql``} order by created_at desc limit 100`;
  return rows.map(row => row.payload as PublicationRequest);
}
export async function getPublication(id: string, actor: CurrentUser): Promise<PublicationRequest> {
  const sql = isDemoMode ? null : getDatabase();
  const item = isDemoMode ? demoRequests().get(id) : (await sql!`select payload from publication_requests where id=${id}`)[0]?.payload as PublicationRequest | undefined;
  if (!item || !visible(item,actor)) throw new AppError("NOT_FOUND","掲載依頼が見つかりません",404);
  if (!sql) return item;
  const notifications = await sql`select m.display_name, n.delivered_at, n.last_error from publication_notifications n join members m on m.id=n.recipient_id where request_id=${id} and request_version=${item.version}`;
  return { ...item, notifications: notifications.map(row => ({ recipientName: row.display_name, status: row.delivered_at ? "sent" : row.last_error ? "failed" : "pending" })) };
}
function notification(item: PublicationRequest) {
  const url = new URL(`/publication-requests/${item.id}`, env.APP_BASE_URL ?? "http://localhost:3000").href;
  const channels = item.channels.map(channel => channel === "その他" ? `その他（${item.otherChannel}）` : channel).join("・");
  const last = item.history.at(-1)!;
  const text = item.version === 1 ? `${item.requesterName}さんから日報の掲載許可の依頼です。\n「${item.title}」\n掲載先：${channels}\n${item.message}\n日報本文と日報の添付が対象です（コメントは含みません）。\nボタンからSlack内で本文を確認して回答できます。`
    : `「${item.title}」の掲載依頼に更新があります。\n掲載先：${channels}\n${last.actorName}：${last.action}\n状態：${PUBLICATION_STATUS[item.status]}${last.note ? `\n\n校正・修正内容：\n${last.note}` : ""}${last.body ? `\n\n投稿本文：\n${last.body}` : ""}${last.url ? `\n\n確認用URL：\n${last.url}` : ""}`;
  const blocks: Extract<import("@slack/web-api").ChatPostMessageArguments, { blocks: unknown }>["blocks"] = [];
  for (let start=0; start<text.length; start+=2800) blocks.push({ type:"section", text:{ type:"plain_text", text:text.slice(start,start+2800) } });
  if (item.version === 1) {
    for (const [decision,label] of Object.entries(DECISIONS)) blocks.push({ type:"actions", elements:[publicationButton(item.id, decision as keyof typeof DECISIONS, label)] });
  } else blocks.push({type:"actions",elements:[publicationButton(item.id, ["awaiting_draft", "changes_requested"].includes(item.status) ? "submit_draft" : "details", item.status === "awaiting_review" ? "Slackで投稿本文とURLを最終確認する" : ["awaiting_draft", "changes_requested"].includes(item.status) ? "Slackで投稿本文とURLを送る" : "Slackで掲載依頼を確認する")]});
  return { text: `${text}\n\n${url}`, blocks, recipientId: item.version === 1 || item.status === "awaiting_review" ? item.authorId : item.requesterId };
}
function initialRequest(report: Report, actor: CurrentUser, input: z.infer<typeof publicationCreateSchema>, id: string): PublicationRequest {
  const now = new Date().toISOString();
  return { id, reportId:report.id,authorId:report.authorId,requesterId:actor.id,authorName:report.author.displayName,requesterName:actor.displayName,title:report.title,reportVersion:report.version,sourceBody:reportPublicationText(report),sourceMedia:report.attachments.map(file => ({id:file.id,filename:file.filename})),channels:input.channels,otherChannel:input.otherChannel,message:input.message,status:"pending",authorBody:"",correctionNote:"",draftBody:"",draftUrl:"",reviewNote:"",version:1,createdAt:now,updatedAt:now,history:[{version:1,actorName:actor.displayName,action:"掲載許可を依頼",at:now}] };
}
export async function createPublication(reportId: string, actor: CurrentUser, input: z.infer<typeof publicationCreateSchema>, id: string) {
  if (!canRequestPublication(actor)) throw new AppError("FORBIDDEN","掲載依頼はMediaまたはAdminだけが行えます",403);
  const report = await getReportRepository().getReadableReport(reportId,actor);
  if (!report || report.status !== "published") throw new AppError("NOT_FOUND","公開中の日報が見つかりません",404);
  if (report.version !== input.reportVersion) throw new AppError("CONFLICT","日報が更新されています。再読み込みしてください",409);
  const item = initialRequest(report,actor,input,id);
  const isOpen = (row: PublicationRequest) => row.reportId === reportId && row.requesterId === actor.id && !["approved","rejected"].includes(row.status);
  if (isDemoMode) {
    const existing = demoRequests().get(id);
    if (existing && existing.requesterId === actor.id && existing.reportId === reportId) return existing;
    if (existing || [...demoRequests().values()].some(isOpen)) throw new AppError("CONFLICT","進行中の掲載依頼があります",409);
    demoRequests().set(id,item); return item;
  }
  const sql = getDatabase();
  return sql.begin(async tx => {
    const [locked] = await tx`select version,status from reports where id=${reportId} for update`;
    if (!locked || locked.status !== "published" || locked.version !== report.version) throw new AppError("CONFLICT","日報が更新されています。再読み込みしてください",409);
    const [existing] = await tx`select payload from publication_requests where id=${id}`;
    if (existing) {
      if (existing.payload.requesterId === actor.id && existing.payload.reportId === reportId) return existing.payload as PublicationRequest;
      throw new AppError("CONFLICT","依頼IDを再作成してください",409);
    }
    const [open] = await tx`select id from publication_requests where report_id=${reportId} and requester_id=${actor.id} and payload->>'status' not in ('approved','rejected')`;
    if (open) throw new AppError("CONFLICT","進行中の掲載依頼があります。既存の依頼を確認してください",409);
    await tx`insert into publication_requests(id,report_id,author_id,requester_id,payload) values(${id},${reportId},${item.authorId},${actor.id},${tx.json(item as never)})`;
    const dm = notification(item);
    await tx`insert into publication_notifications(request_id,request_version,recipient_id,message_text,blocks) values(${id},1,${dm.recipientId},${dm.text},${tx.json(dm.blocks as never)})`;
    return item;
  });
}
export async function actOnPublication(id: string, actor: CurrentUser, action: PublicationAction) {
  function update(item: PublicationRequest) {
    if (!visible(item,actor)) throw new AppError("NOT_FOUND","掲載依頼が見つかりません",404);
    try { return transitionPublication(item,action,actor); }
    catch(error) { if(error instanceof PublicationTransitionError) throw new AppError("PUBLICATION_STATE",error.message,error.status); throw error; }
  }
  if (isDemoMode) {
    const next = update(await getPublication(id,actor)); demoRequests().set(id,next); return next;
  }
  const sql = getDatabase();
  return sql.begin(async tx => {
    const [row] = await tx`select payload from publication_requests where id=${id} for update`;
    if (!row) throw new AppError("NOT_FOUND","掲載依頼が見つかりません",404);
    const next = update(row.payload as PublicationRequest);
    await tx`update publication_requests set payload=${tx.json(next as never)},version=${next.version},updated_at=now() where id=${id}`;
    const dm = notification(next);
    await tx`insert into publication_notifications(request_id,request_version,recipient_id,message_text,blocks) values(${id},${next.version},${dm.recipientId},${dm.text},${tx.json(dm.blocks as never)})`;
    return next;
  });
}
export async function processPublicationNotifications() {
  if (isDemoMode || !env.SLACK_BOT_TOKEN) return;
  const sql = getDatabase();
  const rows = await sql`update publication_notifications set lease_until=now()+interval '2 minutes',attempts=attempts+1
    where id in (select id from publication_notifications where delivered_at is null and available_at<=now() and attempts<8
      and (lease_until is null or lease_until<now()) order by created_at limit 10 for update skip locked) returning *`;
  const client = new WebClient(env.SLACK_BOT_TOKEN,{retryConfig:{retries:0},rejectRateLimitedCalls:true,timeout:15000});
  for (const row of rows) {
    try {
      const [recipient] = await sql`select m.slack_user_id,m.display_name,p.report_id,p.payload->>'title' as title from members m
        join publication_requests p on p.id=${row.request_id} where m.id=${row.recipient_id}`;
      if (!recipient) throw new Error("Recipient missing");
      await sendSystemDm(client,{dedupeKey:`publication:${row.request_id}:${row.request_version}:${row.recipient_id}`,kind:"publication",recipientSlackUserId:recipient.slack_user_id,recipientName:recipient.display_name,text:row.message_text,blocks:row.blocks,reportId:recipient.report_id,reportTitle:recipient.title});
      await sql`update publication_notifications set delivered_at=now(),lease_until=null,last_error=null where id=${row.id}`;
    } catch {
      await sql`update publication_notifications set lease_until=null,last_error='Slack DMの送信を確認できませんでした',available_at=now()+interval '5 minutes' where id=${row.id}`;
    }
  }
}

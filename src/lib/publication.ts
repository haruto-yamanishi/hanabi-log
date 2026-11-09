import { z } from "zod";
import type { CurrentUser, Report } from "@/lib/types";
import { displayMentions } from "@/lib/text";
export const PUBLICATION_CHANNELS = ["X", "Instagram", "note", "IGNITERS(Hanabiオウンドメディア)", "その他"] as const;
export const DECISIONS = {
  original: "オリジナルの日報を編集なしでの公開を許可する",
  self_edit: "自分で一部校正して公開を許可する",
  request_edit: "校正を依頼した上で公開を許可する",
  reject: "公開を拒否する",
} as const;
export const PUBLICATION_STATUS = { pending: "返事待ち", awaiting_draft: "校正・確認用原稿の準備中", awaiting_review: "投稿者の最終確認待ち", changes_requested: "修正依頼あり", approved: "掲載許可済み", rejected: "公開不可" } as const;
export type PublicationStatus = keyof typeof PUBLICATION_STATUS;
export type Decision = keyof typeof DECISIONS;
export function canRequestPublication(user: Pick<CurrentUser, "role">) { return user.role === "admin" || user.role === "media"; }
const draftUrlSchema = z.union([z.literal(""), z.url().max(2000).refine(value => ["https:", "http:"].includes(new URL(value).protocol), "確認用のHTTP(S) URLを入力してください")]).default("");
export const publicationCreateSchema = z.object({
  channels: z.array(z.enum(PUBLICATION_CHANNELS)).min(1).max(5).transform(values => [...new Set(values)]),
  otherChannel: z.string().trim().max(150).default(""),
  message: z.string().trim().max(2000).default(""),
  draftBody: z.string().trim().max(30000).default(""),
  draftUrl: draftUrlSchema,
  channelDrafts: z.array(z.object({ channel: z.enum(PUBLICATION_CHANNELS), body: z.string().trim().max(30000), url: draftUrlSchema }).strict()).max(5).optional(),
  reportVersion: z.number().int().positive(),
}).strict().refine(value => !value.draftUrl || Boolean(value.draftBody), { message: "SNSの投稿文を入力してください", path: ["draftBody"] }).refine(value => !value.channels.includes("その他") || Boolean(value.otherChannel), { message: "その他の掲載先を入力してください", path: ["otherChannel"] }).superRefine((value, ctx) => {
  if (!value.channelDrafts) return;
  const drafts = value.channelDrafts;
  if (value.draftBody || value.draftUrl || drafts.length !== value.channels.length || new Set(drafts.map(draft => draft.channel)).size !== drafts.length || drafts.some(draft => !value.channels.includes(draft.channel))) {
    ctx.addIssue({ code: "custom", path: ["channelDrafts"], message: "選択した掲載先ごとに投稿案を指定してください" });
  }
  if (drafts.some(draft => draft.body || draft.url) && drafts.some(draft => !draft.body)) {
    ctx.addIssue({ code: "custom", path: ["channelDrafts"], message: "選択したすべての掲載先の投稿案を入力してください" });
  }
}).transform(value => {
  if (!value.channelDrafts?.some(draft => draft.body)) return value;
  // Keep a labeled snapshot in the existing review/history flow, including Slack.
  const draftBody = value.channels.map(channel => {
    const draft = value.channelDrafts!.find(draft => draft.channel === channel)!;
    const label = channel === "その他" ? `その他（${value.otherChannel}）` : channel;
    return `【${label}】\n${draft.body}${draft.url ? `\n\n確認用URL：${draft.url}` : ""}`;
  }).join("\n\n");
  return { ...value, draftBody, draftUrl: "" };
}).refine(value => value.draftBody.length <= 30000, { message: "投稿案は掲載先名・URLを含めて合計30,000文字以内で入力してください", path: ["channelDrafts"] });
const bodySchema = z.string().trim().min(1, "本文を入力してください").max(30000);
const noteSchema = z.string().trim().min(1, "校正・修正内容を入力してください").max(4000);
export const publicationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("respond"), version: z.number().int().positive(), decision: z.enum(["original", "self_edit", "request_edit", "reject"]), body: z.string().trim().max(30000).default(""), note: z.string().trim().max(4000).default(""), remarks: z.string().trim().max(2000).optional() }).strict()
    .refine(value => value.decision !== "self_edit" || Boolean(value.body), { message: "校正した本文を入力してください", path: ["body"] })
    .refine(value => value.decision !== "request_edit" || Boolean(value.note), { message: "校正してほしい内容を入力してください", path: ["note"] }),
  z.object({ action: z.literal("submit_draft"), version: z.number().int().positive(), body: bodySchema, url: draftUrlSchema }).strict(),
  z.object({ action: z.literal("review"), version: z.number().int().positive(), decision: z.enum(["approve", "revise", "reject"]), note: z.string().trim().max(4000).default(""), remarks: z.string().trim().max(2000).optional() }).strict()
    .refine(value => value.decision !== "revise" || Boolean(value.note), { message: "修正してほしい内容を入力してください", path: ["note"] }),
]);
export type PublicationAction = z.infer<typeof publicationActionSchema>;
export interface PublicationEvent { version: number; actorName: string; action: string; at: string; body?: string; url?: string; note?: string; remarks?: string }
export interface PublicationRequest {
  id: string; reportId: string; authorId: string; requesterId: string; authorName: string; requesterName: string;
  title: string; reportVersion: number; sourceBody: string; sourceMedia: { id?: string; filename: string }[];
  channels: string[]; otherChannel: string; message: string; status: PublicationStatus; decision?: Decision;
  authorBody: string; correctionNote: string; draftBody: string; draftUrl: string; reviewNote: string;
  version: number; createdAt: string; updatedAt: string; history: PublicationEvent[];
  notifications?: { status: "pending" | "sent" | "failed"; recipientName: string }[];
}
export function reportPublicationText(report: Report) {
  return displayMentions([report.title, ...[["今日やったこと",report.activityText],["判断・学び",report.learningText],["課題・相談",report.issueText],["次のアクション",report.nextActionText]].flatMap(([label,body]) => body ? [`${label}\n${body}`] : []), ...report.relatedLinks.map(link => `${link.label}\n${link.url}`)].join("\n\n"));
}
export class PublicationTransitionError extends Error { constructor(public status: number, message: string) { super(message); } }
export function transitionPublication(current: PublicationRequest, action: PublicationAction, actor: CurrentUser, now = new Date().toISOString()): PublicationRequest {
  if (current.version !== action.version) throw new PublicationTransitionError(409, "ほかの操作で更新されました。再読み込みしてください");
  const next = { ...current, version: current.version + 1, updatedAt: now };
  const author = actor.id === current.authorId;
  const editor = canRequestPublication(actor) && (actor.id === current.requesterId || actor.role === "admin");
  let event: Omit<PublicationEvent, "version" | "at" | "actorName">;
  if (action.action === "respond") {
    if (!author) throw new PublicationTransitionError(403,"日報を書いた本人だけが回答できます");
    if (current.status !== "pending") throw new PublicationTransitionError(409,"この依頼には回答済みです");
    next.decision = action.decision;
    next.status = action.decision === "original" ? "approved" : action.decision === "reject" ? "rejected" : "awaiting_draft";
    next.authorBody = action.decision === "self_edit" ? bodySchema.parse(action.body) : "";
    next.correctionNote = action.decision === "request_edit" ? noteSchema.parse(action.note) : "";
    event = { action: DECISIONS[action.decision], body: next.authorBody, note: action.note, remarks: action.remarks };
  } else if (action.action === "submit_draft") {
    if (!editor) throw new PublicationTransitionError(403,"依頼したMediaメンバーまたはAdminだけが原稿を送れます");
    if (!["awaiting_draft", "changes_requested"].includes(current.status)) throw new PublicationTransitionError(409,"現在は確認用原稿を送れません");
    next.draftBody = action.body; next.draftUrl = action.url; next.status = "awaiting_review";
    event = { action: "確認用原稿を送信", body: action.body, url: action.url };
  } else {
    if (!author) throw new PublicationTransitionError(403,"日報を書いた本人だけが最終確認できます");
    if (current.status !== "awaiting_review") throw new PublicationTransitionError(409,"現在は最終確認できません");
    next.status = action.decision === "approve" ? "approved" : action.decision === "revise" ? "changes_requested" : "rejected";
    next.reviewNote = action.note;
    event = { action: action.decision === "approve" ? "確認した原稿の掲載を許可" : action.decision === "revise" ? "原稿の修正を依頼" : "公開を拒否", note: action.note, remarks: action.remarks };
  }
  next.history = [...current.history, { ...event, version: next.version, at: now, actorName: actor.displayName }];
  return next;
}

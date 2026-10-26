import { z } from "zod";
import type { ModalView, KnownBlock, Button } from "@slack/types";
import { canRequestPublication, DECISIONS, PUBLICATION_STATUS, publicationActionSchema, type PublicationRequest } from "@/lib/publication";
import type { CurrentUser } from "@/lib/types";

export const PUBLICATION_SLACK_ACTION = "publication_open";
export const PUBLICATION_SLACK_MORE = "publication_more";
export const PUBLICATION_SLACK_VIEW = "publication_submit";
export const intentSchema = z.enum(["details", "original", "self_edit", "request_edit", "reject", "submit_draft", "approve", "revise", "review_reject"]);
export type PublicationIntent = z.infer<typeof intentSchema>;
export const publicationButtonSchema = z.object({ id: z.uuid(), intent: intentSchema });
export const publicationModalSchema = publicationButtonSchema.extend({ version: z.number().int().positive(), bodyParts: z.number().int().min(1).max(11) });
export type PublicationModalData = z.infer<typeof publicationModalSchema>;
export type SlackInputValues = Record<string, Record<string, { value?: string | null }>>;
const plain = (text: string) => ({ type: "plain_text" as const, text });
export function textBlocks(text: string): KnownBlock[] {
  const result: KnownBlock[] = [];
  // Array.from preserves surrogate pairs when splitting emoji and other Unicode text.
  const characters = Array.from(text);
  for (let start = 0; start < characters.length; start += 1400) {
    result.push({ type: "section", text: plain(characters.slice(start, start + 1400).join("")) });
  }
  return result;
}
export function publicationButton(id: string, intent: PublicationIntent, label: string): Button {
  return { type: "button", text: plain(label), action_id: PUBLICATION_SLACK_ACTION, value: JSON.stringify({ id, intent }) };
}
function choices(item: PublicationRequest, actor: CurrentUser): [PublicationIntent, string][] {
  if (item.authorId === actor.id && item.status === "pending") return Object.entries(DECISIONS) as [PublicationIntent, string][];
  if (item.authorId === actor.id && item.status === "awaiting_review") return [["approve", "この投稿本文・URLで公開を許可する"], ["revise", "修正を依頼する"], ["review_reject", "公開を拒否する"]];
  if (canRequestPublication(actor) && (item.requesterId === actor.id || actor.role === "admin") && ["awaiting_draft", "changes_requested"].includes(item.status)) return [["submit_draft", "投稿本文とURLを確認してもらう"]];
  return [];
}
export function publicationInfoModal(text: string): ModalView {
  return { type: "modal", title: plain("掲載許可"), close: plain("閉じる"), blocks: textBlocks(text) };
}
function input(blockId: string, label: string, value: string, optional: boolean, maxLength = 3000): KnownBlock {
  return { type: "input", block_id: blockId, label: plain(label), optional,
    element: { type: "plain_text_input", action_id: "value", multiline: blockId !== "url", max_length: maxLength, ...(value ? { initial_value: value } : {}) } };
}
function bodyChunks(body: string): string[] {
  const chunks: string[] = [];
  let remainder = body;
  while (remainder.length) {
    let end = Math.min(3000, remainder.length);
    if (end < remainder.length && /[\uD800-\uDBFF]/.test(remainder[end - 1])) end--;
    chunks.push(remainder.slice(0, end)); remainder = remainder.slice(end);
  }
  return chunks;
}
export function publicationModal(item: PublicationRequest, actor: CurrentUser, requestedIntent: PublicationIntent, requestedParts = 1): ModalView {
  const options = choices(item, actor);
  const intent = options.some(([key]) => key === requestedIntent) ? requestedIntent : "details";
  const blocks = textBlocks(`「${item.title}」\n掲載先：${item.channels.map(channel => channel === "その他" ? `その他（${item.otherChannel}）` : channel).join("・")}\n${item.requesterName} → ${item.authorName}\n状態：${PUBLICATION_STATUS[item.status]}\n${item.message}\n依頼時の日報本文・添付が対象です。コメントは含みません。`);
  const editing = intent === "self_edit" || intent === "submit_draft";
  if (!editing) blocks.push(...textBlocks(item.draftBody ? `確認用の投稿本文\n${item.draftBody}\n\n確認用URL\n${item.draftUrl}` : `依頼時の日報本文\n${item.sourceBody}`));
  if (item.sourceMedia.length) blocks.push(...textBlocks(`対象の添付：\n${item.sourceMedia.map(file => file.filename).join("\n")}`));
  if (item.correctionNote) blocks.push(...textBlocks(`校正してほしい内容：\n${item.correctionNote}`));
  if (item.reviewNote) blocks.push(...textBlocks(`最終確認のコメント：\n${item.reviewNote}`));
  let bodyParts = 1;
  if (editing) {
    const body = intent === "self_edit" ? item.sourceBody : item.draftBody || item.authorBody || item.sourceBody;
    const chunks = bodyChunks(body.length <= 30000 ? body : "");
    if (body.length > 30000) blocks.push(...textBlocks(`元の日報は30,000文字を超えています。以下を参照し、校正した本文を30,000文字以内で入力してください。\n${body}`));
    bodyParts = Math.min(11, Math.max(requestedParts, chunks.length, 1));
    blocks.push(...textBlocks("本文が長い場合は続きの入力欄を追加できます。各欄はそのまま連結されます。改行は本文に入力してください。"));
    for (let index = 0; index < bodyParts; index++) blocks.push(input(`body_${index}`, index ? `投稿本文の続き（${index + 1}）` : "投稿本文", chunks[index] ?? "", index > 0));
    if (bodyParts < 11) blocks.push({ type: "actions", elements: [{ type: "button", text: plain("続きの入力欄を追加"), action_id: PUBLICATION_SLACK_MORE, value: "more" }] });
    if (intent === "submit_draft") blocks.push(input("url", "確認用URL（https://…）", item.draftUrl, false, 2000));
  }
  if (["request_edit", "revise", "approve", "review_reject", "reject"].includes(intent)) {
    blocks.push(input("note_0", intent === "request_edit" ? "校正してほしい内容" : "コメント・修正してほしい内容", "", !["request_edit", "revise"].includes(intent)));
    blocks.push(input("note_1", "コメントの続き（任意）", "", true, 1000));
  }
  if (intent === "details") {
    for (const [key, label] of options) blocks.push({ type: "actions", elements: [publicationButton(item.id, key, label)] });
  } else blocks.push(...textBlocks(options.find(([key]) => key === intent)![1] + "。内容を確認して「送信」を押してください。"));
  return { type: "modal", callback_id: PUBLICATION_SLACK_VIEW, title: plain("掲載許可"), close: plain("閉じる"),
    ...(intent === "details" ? {} : { submit: plain("送信") }),
    private_metadata: JSON.stringify({ id: item.id, version: item.version, intent, bodyParts }), blocks };
}
export function publicationActionFromModal(metadata: PublicationModalData, values: SlackInputValues) {
  const value = (key: string) => values[key]?.value?.value ?? "";
  const body = Array.from({ length: metadata.bodyParts }, (_, index) => value(`body_${index}`)).join("");
  const note = value("note_0") + value("note_1");
  if (metadata.intent === "submit_draft") return publicationActionSchema.parse({ action: "submit_draft", version: metadata.version, body, url: value("url") });
  if (["approve", "revise", "review_reject"].includes(metadata.intent)) return publicationActionSchema.parse({ action: "review", version: metadata.version, decision: metadata.intent === "review_reject" ? "reject" : metadata.intent, note });
  return publicationActionSchema.parse({ action: "respond", version: metadata.version, decision: metadata.intent, body, note });
}

"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiRequest } from "@/components/api-client";
import { canRequestPublication, PUBLICATION_CHANNELS, type PublicationRequest } from "@/lib/publication";
import type { CurrentUser, Report } from "@/lib/types";
export function PublicationRequestForm({report,user}:{report:Report;user:CurrentUser}) {
  const router = useRouter();
  const [open,setOpen] = useState(false);
  const [channels,setChannels] = useState<string[]>([]);
  const [otherChannel,setOther] = useState("");
  const [message,setMessage] = useState("");
  const [drafts,setDrafts] = useState<Record<string, { body: string; url: string }>>({});
  const hasDraft = channels.some(channel => drafts[channel]?.body.trim() || drafts[channel]?.url.trim());
  function updateDraft(channel: string, field: "body" | "url", value: string) {
    setDrafts(current => ({ ...current, [channel]: { ...(current[channel] ?? { body: "", url: "" }), [field]: value } }));
  }
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  async function submit(event:FormEvent) {
    event.preventDefault(); if(busy) return; setBusy(true);setError("");
    try {
      const result = await apiRequest<PublicationRequest>(`/api/reports/${report.id}/publication-requests`,{method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify({channels,otherChannel,message,channelDrafts:channels.map(channel => ({channel,body:drafts[channel]?.body ?? "",url:drafts[channel]?.url ?? ""})),reportVersion:report.version})});
      router.push(`/publication-requests/${result.id}`);
    } catch(error) { setError(error instanceof Error ? error.message : "掲載依頼を送れませんでした");setBusy(false); }
  }
  return <section className="publication-panel" aria-label="投稿への掲載許可">
    <div className="publication-actions">
      {report.status === "published" && canRequestPublication(user) ? <button type="button" className="button button--secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>投稿への掲載許可を依頼する</button> : null}
      <Link href={`/publication-requests?reportId=${report.id}`}>掲載許可の依頼・履歴</Link>
    </div>
    {open ? <form onSubmit={submit} className="publication-form">
      <p>日報を書いた人にSlack DMで掲載許可を依頼します。対象はこの日報の本文と添付です。コメントは含みません。</p>
      <fieldset><legend>掲載先（複数選択可・必須）</legend><div className="publication-channels">{PUBLICATION_CHANNELS.map(channel => <label key={channel}><input type="checkbox" checked={channels.includes(channel)} onChange={event => setChannels(current => event.target.checked ? [...current,channel] : current.filter(value => value!==channel))} />{channel}</label>)}</div></fieldset>
      {channels.includes("その他") ? <label>その他の掲載先<input required maxLength={150} value={otherChannel} onChange={event => setOther(event.target.value)} /></label> : null}
      <label>依頼メッセージ<textarea rows={3} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} placeholder="掲載の目的や予定時期など" /></label>
      {channels.map(channel => <fieldset key={channel}>
        <legend>{channel === "その他" && otherChannel ? `その他（${otherChannel}）` : channel}の投稿案</legend>
        <label>{channel}の投稿文<textarea rows={8} required={hasDraft} maxLength={30000} value={drafts[channel]?.body ?? ""} onChange={event => updateDraft(channel, "body", event.target.value)} placeholder={`${channel}に掲載したい文章を入力してください`} /></label>
        <label>{channel}の確認用URL（任意）<input type="url" maxLength={2000} value={drafts[channel]?.url ?? ""} onChange={event => updateDraft(channel, "url", event.target.value)} placeholder="https://…" /></label>
      </fieldset>)}
      <p className="publication-help">投稿案は最初の依頼からWeb・Slackで確認できます。投稿案を添える場合は、選択したすべての掲載先の文章を入力してください（掲載先名・URLを含め合計30,000文字以内）。相手はすべての投稿案をまとめて許可・修正依頼・拒否できます。すべて空欄の場合は日報原文の掲載許可を依頼します。</p>
      {error ? <p role="alert" className="inline-error">{error}</p> : null}
      <button className="button button--primary" disabled={busy || !channels.length} type="submit">{busy ? "送信中…" : "掲載許可を依頼してDMを送る"}</button>
    </form> : null}
  </section>;
}

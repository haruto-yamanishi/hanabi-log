"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/components/api-client";
import { EmptyState, ErrorState, LoadingView, PageHeader } from "@/components/ui";
import { canRequestPublication, DECISIONS, PUBLICATION_STATUS, type Decision, type PublicationRequest } from "@/lib/publication";
import type { CurrentUser } from "@/lib/types";
import { formatDateTime } from "@/components/report-card";

export function PublicationListScreen({reportId}:{reportId?:string}) {
  const [items,setItems] = useState<PublicationRequest[] | null>(null);
  const [error,setError] = useState("");
  useEffect(() => {
    const controller=new AbortController();
    void apiRequest<PublicationRequest[]>(`/api/publication-requests${reportId ? `?reportId=${encodeURIComponent(reportId)}` : ""}`,{signal:controller.signal}).then(setItems).catch(error => {if(!controller.signal.aborted)setError(error.message);});
    return () => controller.abort();
  },[reportId]);
  return <div className="page"><PageHeader title="掲載許可" description="自分に届いた依頼と、自分が送った依頼を確認できます。Adminはすべての依頼を確認できます。" />
    {error ? <ErrorState message={error} /> : !items ? <LoadingView /> : !items.length ? <EmptyState title="掲載依頼はまだありません" message="Media・Adminは日報の詳細ページから掲載許可を依頼できます。" /> : <div className="publication-list">{items.map(item => <Link key={item.id} href={`/publication-requests/${item.id}`} className="publication-list__item"><span className="category-badge">{PUBLICATION_STATUS[item.status]}</span><h2>{item.title}</h2><p>{item.requesterName} → {item.authorName}</p><p>{item.channels.join("・")}</p><small>{formatDateTime(item.createdAt)}</small></Link>)}</div>}
  </div>;
}
export function PublicationScreen({id,initialDecision}:{id:string;initialDecision?:string}) {
  const [item,setItem]=useState<PublicationRequest | null>(null);
  const [user,setUser]=useState<CurrentUser | null>(null);
  const [error,setError]=useState("");
  useEffect(() => {
    const controller=new AbortController();
    void Promise.all([apiRequest<PublicationRequest>(`/api/publication-requests/${id}`,{signal:controller.signal}),apiRequest<CurrentUser>("/api/me",{signal:controller.signal})]).then(([result,me])=>{setItem(result);setUser(me);}).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[id]);
  if(error) return <div className="page"><ErrorState message={error} onRetry={()=>window.location.reload()} /></div>;
  if(!item || !user)return <div className="page"><LoadingView /></div>;
  return <PublicationDetail key={`${item.id}:${item.version}`} item={item} user={user} initialDecision={initialDecision} onUpdate={setItem} />;
}
function PublicationDetail({item,user,initialDecision,onUpdate}:{item:PublicationRequest;user:CurrentUser;initialDecision?:string;onUpdate:(item:PublicationRequest)=>void}) {
  const [decision,setDecision]=useState<Decision | "">(()=>initialDecision && Object.hasOwn(DECISIONS,initialDecision) ? initialDecision as Decision : "");
  const [body,setBody]=useState(item.authorBody || item.sourceBody);
  const [note,setNote]=useState("");
  const [draftBody,setDraftBody]=useState(item.draftBody || item.authorBody || item.sourceBody);
  const [draftUrl,setDraftUrl]=useState(item.draftUrl);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const author=user.id===item.authorId;
  const editor=canRequestPublication(user) && (user.id===item.requesterId || user.role==="admin");
  async function send(action: Record<string,unknown>) {
    if(busy)return; setBusy(true);setError("");
    try {onUpdate(await apiRequest<PublicationRequest>(`/api/publication-requests/${item.id}`,{method:"POST",body:JSON.stringify({...action,version:item.version})}));}
    catch(error){setError(error instanceof Error ? error.message : "保存できませんでした");setBusy(false);}
  }
  function respond(event:FormEvent){event.preventDefault();void send({action:"respond",decision,body,note});}
  return <div className="page publication-detail">
    <PageHeader title="投稿への掲載許可" backHref="/publication-requests" description={`${item.requesterName}さんから${item.authorName}さんへの依頼`} />
    <section className="publication-panel">
      <span className="category-badge" role="status" aria-label="掲載許可の状態">{PUBLICATION_STATUS[item.status]}</span>
      <h2><Link href={`/reports/${item.reportId}`}>{item.title}</Link></h2>
      <p>掲載先：{item.channels.map(channel=>channel==="その他" ? `その他（${item.otherChannel}）` : channel).join("・")}</p>
      {item.message ? <p className="publication-text">{item.message}</p>:null}
      <p className="publication-help">依頼時点の日報（版 {item.reportVersion}）の本文・添付が対象です。コメントは含みません。外部サービスへの投稿は担当者が行います。</p>
      <details><summary>依頼時の日報本文・添付を確認する</summary><pre className="publication-text">{item.sourceBody}</pre>{item.sourceMedia.length ? <ul>{item.sourceMedia.map((file,index)=><li key={file.id || index}>{file.filename}</li>)}</ul>:<p>添付なし</p>}</details>
      {item.decision ? <p>返事：{DECISIONS[item.decision]}</p>:null}
      {item.correctionNote ? <div><h3>校正してほしい内容</h3><p className="publication-text">{item.correctionNote}</p></div>:null}
      {item.authorBody ? <details><summary>日報投稿者が校正した本文</summary><pre className="publication-text">{item.authorBody}</pre></details>:null}
      {item.reviewNote ? <div><h3>最終確認のコメント</h3><p className="publication-text">{item.reviewNote}</p></div>:null}
      {item.status==="approved" ? <p className="notice-banner">{item.decision==="original" ? "依頼時の原文を編集せず、選択された掲載先へ公開できます。" : "最終確認した投稿本文とURLで、選択された掲載先へ公開できます。"}</p>:null}
      {item.notifications?.map((dm,index)=><p key={index} className="publication-help">{dm.recipientName}さんへのDM：{dm.status==="sent"?"送信済み":dm.status==="failed"?"送信を確認できていません。再送を待っています（管理画面で送信履歴を確認できます）。":"送信待ち"}</p>)}
    </section>
    {error ? <p className="inline-error" role="alert">{error} <button type="button" onClick={()=>window.location.reload()}>最新の状態を読み込む</button></p>:null}
    {author && item.status==="pending" ? <form onSubmit={respond} className="publication-panel publication-form"><h2>掲載許可への返事</h2>
      <div className="publication-choices">{Object.entries(DECISIONS).map(([key,label])=><button className={`button ${decision===key ? "button--primary":"button--secondary"}`} type="button" key={key} aria-pressed={decision===key} onClick={()=>setDecision(key as Decision)}>{label}</button>)}</div>
      {decision==="self_edit" ? <label>校正した投稿本文<textarea aria-label="校正した投稿本文" required rows={14} maxLength={30000} value={body} onChange={event=>setBody(event.target.value)} /></label>:null}
      {decision==="request_edit" ? <label>校正を依頼する内容<textarea aria-label="校正を依頼する内容" required rows={5} maxLength={4000} value={note} onChange={event=>setNote(event.target.value)} placeholder="伏せたい名前、削除したい部分、言い換えてほしい内容など" /></label>:null}
      {decision==="self_edit" || decision==="request_edit" ? <p>担当者が用意した投稿本文と確認用URLを、公開前にもう一度確認できます。元の日報は変更されません。</p>:null}
      <button className="button button--primary" type="submit" disabled={busy || !decision}>{busy?"送信中…":"この内容で返事を送る"}</button>
    </form>:null}
    {editor && ["awaiting_draft","changes_requested"].includes(item.status) ? <form className="publication-panel publication-form" onSubmit={event=>{event.preventDefault();void send({action:"submit_draft",body:draftBody,url:draftUrl});}}><h2>投稿本文・URLを確認してもらう</h2>
      <p>公開前の共有プレビューURLなど、日報を書いた人が確認できるURLを指定してください。</p>
      <label>確認用の投稿本文<textarea aria-label="確認用の投稿本文" required maxLength={30000} rows={14} value={draftBody} onChange={event=>setDraftBody(event.target.value)} /></label>
      <label>確認用URL<input required type="url" maxLength={2000} value={draftUrl} onChange={event=>setDraftUrl(event.target.value)} placeholder="https://…" /></label>
      <button className="button button--primary" type="submit" disabled={busy}>{busy?"送信中…":"投稿本文とURLをDMで送る"}</button>
    </form>:null}
    {item.draftBody ? <section className="publication-panel"><h2>確認用の投稿本文</h2><pre className="publication-text">{item.draftBody}</pre><a className="button button--secondary" href={item.draftUrl} target="_blank" rel="noreferrer">確認用URLを開く ↗</a></section>:null}
    {author && item.status==="awaiting_review" ? <section className="publication-panel publication-form"><h2>投稿本文・URLの最終確認</h2>
      <label>修正してほしい内容・コメント<textarea aria-label="修正してほしい内容・コメント" rows={4} maxLength={4000} value={note} onChange={event=>setNote(event.target.value)} /></label>
      <div className="publication-actions"><button type="button" className="button button--primary" disabled={busy} onClick={()=>void send({action:"review",decision:"approve",note})}>この投稿本文・URLで公開を許可する</button><button type="button" className="button button--secondary" disabled={busy || !note.trim()} onClick={()=>void send({action:"review",decision:"revise",note})}>修正を依頼する</button><button type="button" className="button button--ghost button--danger" disabled={busy} onClick={()=>void send({action:"review",decision:"reject",note})}>公開を拒否する</button></div>
    </section>:null}
    <section className="publication-panel"><h2>依頼・校正の履歴</h2><ol className="publication-history">{item.history.map(event=><li key={event.version}><strong>{event.action}</strong><p>{event.actorName} · {formatDateTime(event.at)}</p>{event.note?<p className="publication-text">{event.note}</p>:null}{event.body?<details><summary>この時点の本文・URL</summary><pre className="publication-text">{event.body}</pre>{event.url?<a href={event.url} target="_blank" rel="noreferrer">{event.url}</a>:null}</details>:null}</li>)}</ol></section>
  </div>;
}

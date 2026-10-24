"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaItem, MediaPage } from "@/lib/media-gallery";
import { apiRequest } from "@/components/api-client";
import { EmptyState, ErrorState, LoadingView, PageHeader } from "@/components/ui";
import { formatReportDate } from "@/components/report-card";

function MediaCard({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const url = `${item.url}&retry=${attempt}`;
  return <article className="media-card">
    <div className="media-card__preview">
      {failed ? <div className="media-card__unavailable"><p>プレビューを読み込めませんでした</p><button type="button" className="button button--small button--secondary" onClick={() => { setAttempt(value => value + 1); setFailed(false); }}>再読み込み</button></div>
        : item.mimeType.startsWith("video/") ? <video aria-label={item.filename} controls playsInline preload="none" src={url} onError={() => setFailed(true)} />
        : <a href={url} target="_blank" rel="noreferrer" aria-label={`${item.filename}を拡大`}><img alt={item.filename} loading="lazy" src={url} onError={() => setFailed(true)} /></a>}
      <span className="media-card__badge">{item.mimeType.startsWith("video/") ? "動画" : "写真"} · {item.source === "comment" ? "コメント" : "日報"}</span>
    </div>
    <div className="media-card__body">
      <time dateTime={item.reportDate}>{formatReportDate(item.reportDate, true)}</time>
      <h2><Link href={`/reports/${item.reportId}`}>{item.title}</Link></h2>
      <Link className="media-card__author" href={`/members/${item.authorId}`}>日報を書いた人：{item.authorName}</Link>
      <div className="media-card__links"><Link href={`/reports/${item.reportId}`}>日報本文へ →</Link>{item.commentId ? <Link href={`/reports/${item.reportId}#comments-heading`}>コメントへ →</Link> : null}</div>
    </div>
  </article>;
}
export function MediaScreen() {
  const [kind, setKind] = useState("all");
  const [source, setSource] = useState("all");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async (next?: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ kind, source });
      if (next) params.set("cursor", next);
      const result = await apiRequest<MediaPage>(`/api/media?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setItems(current => next ? [...current, ...result.items.filter(item => !current.some(existing => existing.id === item.id))] : result.items);
      setCursor(result.nextCursor);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "メディアを読み込めませんでした");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [kind, source]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); request.current?.abort(); };
  }, [load]);
  return <div className="page media-page">
    <PageHeader title="メディア" description="日報とコメントに集まった写真・動画。活動の記録を、ここから。" actions={<Link className="button button--secondary" href="/publication-requests">掲載許可の依頼・履歴</Link>} />
    <div className="media-filters">
      <label htmlFor="media-kind"><span>種類</span><select aria-label="種類" id="media-kind" value={kind} onChange={event => { setItems([]); setCursor(null); setLoading(true); setKind(event.target.value); }}><option value="all">写真・動画すべて</option><option value="image">写真</option><option value="video">動画</option></select></label>
      <label htmlFor="media-source"><span>添付先</span><select aria-label="添付先" id="media-source" value={source} onChange={event => { setItems([]); setCursor(null); setLoading(true); setSource(event.target.value); }}><option value="all">日報・コメントすべて</option><option value="report">日報</option><option value="comment">コメント</option></select></label>
      <span>日報の日付が新しい順</span>
    </div>
    {error ? <ErrorState message={error} onRetry={() => void load(items.length ? cursor ?? undefined : undefined)} /> : null}
    <div className="media-grid">{items.map(item => <MediaCard key={item.id} item={item} />)}</div>
    {loading ? <LoadingView label="メディアを読み込んでいます" /> : !error && !items.length ? <EmptyState title="メディアはまだありません" message="公開された日報やコメントの写真・動画がここに並びます。" /> : null}
    {!loading && cursor ? <button type="button" className="button button--secondary media-more" onClick={() => void load(cursor)}>もっと見る</button> : null}
  </div>;
}

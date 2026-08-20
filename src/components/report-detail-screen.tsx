"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CurrentUser, Report } from "@/lib/types";
import { apiRequest } from "@/components/api-client";
import { ArchiveIcon, ArrowLeftIcon, CalendarIcon, CheckIcon, EditIcon, ExternalLinkIcon, LinkIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import { formatDateTime, formatReportDate, StatusBadge } from "@/components/report-card";
import { SyncStatusPanel } from "@/components/sync-status";
import { Avatar, ErrorState, LoadingView } from "@/components/ui";
import { activityAreaClassName } from "@/lib/constants";

export function ReportDetailScreen({ reportId, initialNotice }: { reportId: string; initialNotice?: string }) {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice || null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [loadedReport, me] = await Promise.all([
        apiRequest<Report>(`/api/reports/${reportId}`, { signal }),
        apiRequest<CurrentUser>("/api/me", { signal }),
      ]);
      setReport(loadedReport);
      setUser(me);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "日報を読み込めませんでした");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  async function changeStatus(action: "archive" | "restore") {
    if (!report) return;
    const question = action === "archive"
      ? "この日報をアーカイブしますか？ 本文は残り、SlackとNotionの状態も更新されます。"
      : "この日報を公開状態へ復元しますか？";
    if (!window.confirm(question)) return;
    setActing(true);
    setError(null);
    try {
      const updated = await apiRequest<Report>(`/api/reports/${report.id}/${action}`, { method: "POST" });
      setReport(updated);
      setNotice(action === "archive" ? "日報をアーカイブしました。" : "日報を公開状態へ復元しました。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "状態を変更できませんでした");
    } finally {
      setActing(false);
    }
  }

  async function deleteReport() {
    if (!report || user?.role !== "admin") return;
    if (!window.confirm(
      `「${report.title}」を完全に削除しますか？\n\nWeb上の日報と添付画像を削除し、Slack投稿を削除、Notionページをゴミ箱へ移動します。この操作は元に戻せません。`,
    )) return;
    setActing(true);
    setError(null);
    try {
      await apiRequest<void>(`/api/reports/${report.id}`, { method: "DELETE" });
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "日報を削除できませんでした");
      setActing(false);
    }
  }

  if (loading) return <div className="page"><LoadingView label="日報を読み込んでいます" /></div>;
  if (error && !report) return <div className="page"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!report) return <div className="page"><ErrorState message="URLを確認してください。" title="日報が見つかりません" /></div>;

  const canEdit = user?.role === "admin" || user?.id === report.authorId;
  const canRestore = user?.role === "admin" && report.status === "archived";
  const slackUrl = report.integration?.slackPermalink;
  const notionUrl = report.integration?.notionPageUrl;

  return (
    <div className="page page--report-detail">
      <div className="detail-topbar">
        <Link className="back-link" href="/"><ArrowLeftIcon />ホームへ</Link>
        <div className="detail-topbar__actions">
          {canEdit && report.status !== "archived" ? <Link className="button button--secondary button--small" href={`/reports/${report.id}/edit`}><EditIcon />編集</Link> : null}
          {canEdit && report.status !== "archived" ? <button className="button button--ghost button--small button--danger" disabled={acting} onClick={() => void changeStatus("archive")} type="button"><ArchiveIcon />アーカイブ</button> : null}
          {canRestore ? <button className="button button--secondary button--small" disabled={acting} onClick={() => void changeStatus("restore")} type="button"><RefreshIcon />公開へ復元</button> : null}
          {user?.role === "admin" ? <button className="button button--ghost button--small button--danger" disabled={acting} onClick={() => void deleteReport()} type="button"><TrashIcon />完全削除</button> : null}
        </div>
      </div>

      {notice ? <div aria-live="polite" className="notice-banner"><CheckIcon />{notice}</div> : null}
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {report.status === "archived" ? <div className="archived-banner"><ArchiveIcon /><p><strong>アーカイブされた日報です</strong><span>記録として保存されています。公開一覧には表示されません。</span></p></div> : null}
      {report.status === "draft" ? <div className="draft-banner"><EditIcon /><p><strong>下書きです</strong><span>SlackとNotionにはまだ配信されていません。</span></p></div> : null}

      <article className={`report-article ${activityAreaClassName(report.activityArea)}`}>
        <header className="report-article__header">
          <div className="badge-row">
            <span className="category-badge category-badge--area">{report.activityArea}</span>
            <span className="category-badge">{report.contentCategory}</span>
            <StatusBadge status={report.status} />
          </div>
          <h1>{report.title}</h1>
          {report.summary ? <p className="report-article__summary">{report.summary}</p> : null}
          <div className="report-byline">
            <Avatar name={report.author.displayName} src={report.author.avatarUrl} />
            <div><strong>{report.author.displayName}</strong><span><CalendarIcon /><time dateTime={report.reportDate}>{formatReportDate(report.reportDate, true)}</time></span></div>
            <p>最終更新 <time dateTime={report.updatedAt}>{formatDateTime(report.updatedAt)}</time></p>
          </div>
          {report.themeTags.length ? <ul aria-label="テーマタグ" className="tag-list tag-list--detail">{report.themeTags.map((tag) => <li key={tag}>#{tag}</li>)}</ul> : null}
        </header>

        <div className="report-article__body">
          <ReportSection content={report.activityText} index="01" title="今日やったこと" />
          {report.learningText ? <ReportSection content={report.learningText} index="02" title="判断・学び" /> : null}
          {report.issueText ? <ReportSection content={report.issueText} index="03" title="課題・相談" tone="issue" /> : null}
          {report.nextActionText ? <ReportSection content={report.nextActionText} index="04" title="次のアクション" tone="action" /> : null}

          {report.attachments.length ? (
            <section aria-labelledby="images-heading" className="report-section report-section--media">
              <div className="report-section__heading"><span>PHOTO</span><h2 id="images-heading">画像</h2></div>
              <div className="report-images">
                {report.attachments.map((attachment) => attachment.signedUrl ? (
                  <figure key={attachment.id || attachment.storagePath}><img alt={attachment.altText || "日報に添付された画像"} src={attachment.signedUrl} /><figcaption>{attachment.altText || attachment.filename}</figcaption></figure>
                ) : (
                  <div className="report-image-placeholder" key={attachment.id || attachment.storagePath}><span>画像</span><p>{attachment.filename}</p></div>
                ))}
              </div>
            </section>
          ) : null}

          {report.relatedLinks.length ? (
            <section aria-labelledby="links-heading" className="report-section report-section--links">
              <div className="report-section__heading"><span>LINK</span><h2 id="links-heading">関連リンク</h2></div>
              <ul>{report.relatedLinks.map((link) => <li key={link.id || link.url}><a href={link.url} rel="noreferrer" target="_blank"><LinkIcon /><span>{link.label}<small>{link.url}</small></span><ExternalLinkIcon /></a></li>)}</ul>
            </section>
          ) : null}
        </div>
      </article>

      {report.status !== "draft" ? <SyncStatusPanel integration={report.integration} /> : null}

      {report.status === "published" ? (
        <aside className="conversation-card">
          <div><h2>Slack</h2></div>
          <div>
            {slackUrl ? <a className="button button--slack" href={slackUrl} rel="noreferrer" target="_blank">Slackで話す<ExternalLinkIcon /></a> : <button className="button button--secondary" disabled type="button">Slackへ同期中</button>}
            {notionUrl ? <a className="button button--secondary" href={notionUrl} rel="noreferrer" target="_blank">Notionで開く<ExternalLinkIcon /></a> : null}
          </div>
        </aside>
      ) : null}

      <div className="mobile-detail-actions">
        {report.status === "published" && slackUrl ? <a className="button button--slack" href={slackUrl} rel="noreferrer" target="_blank">Slackで話す<ExternalLinkIcon /></a> : null}
        {canEdit && report.status !== "archived" ? <Link aria-label="日報を編集" className="button button--secondary button--icon" href={`/reports/${report.id}/edit`}><EditIcon /></Link> : null}
      </div>
    </div>
  );
}

function ReportSection({ title, content, index, tone }: { title: string; content: string; index: string; tone?: "issue" | "action" }) {
  return (
    <section className={`report-section${tone ? ` report-section--${tone}` : ""}`}>
      <div className="report-section__heading"><span>{index}</span><h2>{title}</h2></div>
      <div className="report-section__content">{content}</div>
    </section>
  );
}

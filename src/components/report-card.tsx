"use client";

import Link from "next/link";
import { useState } from "react";
import type { Report, ReportLikeSummary } from "@/lib/types";
import { ArrowRightIcon, CalendarIcon, HeartIcon } from "@/components/icons";
import { Avatar } from "@/components/ui";
import { activityAreaClassName } from "@/lib/constants";
import { apiRequest } from "@/components/api-client";

const STATUS_LABELS = {
  draft: "下書き",
  pending_approval: "承認待ち",
  published: "公開済み",
  archived: "アーカイブ",
} as const;

export function formatReportDate(value: string, includeYear = false): string {
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: includeYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatPublishedDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.month}月${values.day}日 ${values.hour}時${values.minute}分`;
}

export function StatusBadge({ status }: { status: Report["status"] }) {
  return <span className={`status-badge status-badge--${status}`}>{STATUS_LABELS[status]}</span>;
}

export function ReportCard({ report, showStatus = false }: { report: Report; showStatus?: boolean }) {
  const [liked, setLiked] = useState(report.likedByCurrentUser ?? false);
  const [likeCount, setLikeCount] = useState(report.likeCount ?? 0);
  const [liking, setLiking] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const postedAt = report.publishedAt ?? report.createdAt;

  async function toggleLike() {
    if (liking || report.status !== "published") return;
    const nextLiked = !liked;
    setLiking(true);
    setLikeError(null);
    try {
      const result = await apiRequest<ReportLikeSummary>(`/api/reports/${report.id}/like`, {
        method: nextLiked ? "PUT" : "DELETE",
        keepalive: true,
      });
      setLiked(result.liked);
      setLikeCount(result.likeCount);
    } catch (cause) {
      setLikeError(cause instanceof Error ? cause.message : "いいねを更新できませんでした");
    } finally {
      setLiking(false);
    }
  }

  return (
    <article className={`report-card ${activityAreaClassName(report.activityArea)}`}>
      <Link aria-label={`${report.title}を読む`} className="report-card__link" href={`/reports/${report.id}`}>
        <div className="report-card__topline">
          <div className="badge-row">
            <span className="category-badge category-badge--area">{report.activityArea}</span>
            <span className="category-badge">{report.contentCategory}</span>
            {showStatus ? <StatusBadge status={report.status} /> : null}
          </div>
          <ArrowRightIcon className="report-card__arrow" />
        </div>
        <h3>{report.title}</h3>
        {report.summary ? <p className="report-card__summary">{report.summary}</p> : null}
        {report.themeTags.length ? (
          <ul aria-label="テーマタグ" className="tag-list">
            {report.themeTags.slice(0, 3).map((tag) => <li key={tag}>#{tag}</li>)}
            {report.themeTags.length > 3 ? <li>+{report.themeTags.length - 3}</li> : null}
          </ul>
        ) : null}
        <footer className="report-card__meta">
          <span className="report-card__author">
            <Avatar name={report.author.displayName} size="small" src={report.author.avatarUrl} />
            <span>{report.author.displayName}</span>
          </span>
          <time dateTime={postedAt} title={formatDateTime(postedAt)}>
            <CalendarIcon />
            {formatPublishedDateTime(postedAt)}
          </time>
        </footer>
      </Link>
      {report.status === "published" ? (
        <button
          aria-label={`「${report.title}」を${liked ? "いいね解除" : "いいね"}、現在${likeCount}件`}
          aria-pressed={liked}
          className="report-card__like-button"
          disabled={liking}
          onClick={() => void toggleLike()}
          title={liked ? "いいねを解除" : "いいね"}
          type="button"
        >
          <HeartIcon />
          <span>{likeCount}</span>
        </button>
      ) : (
        <span className="report-card__like-count" title={`${likeCount}件のいいね`}>
          <HeartIcon />
          {likeCount}
        </span>
      )}
      {likeError ? <span className="sr-only" role="alert">{likeError}</span> : null}
    </article>
  );
}

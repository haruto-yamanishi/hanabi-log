import Link from "next/link";
import type { Report } from "@/lib/types";
import { ArrowRightIcon, CalendarIcon, HeartIcon } from "@/components/icons";
import { Avatar } from "@/components/ui";
import { activityAreaClassName } from "@/lib/constants";

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

export function StatusBadge({ status }: { status: Report["status"] }) {
  return <span className={`status-badge status-badge--${status}`}>{STATUS_LABELS[status]}</span>;
}

export function ReportCard({ report, showStatus = false }: { report: Report; showStatus?: boolean }) {
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
          <time dateTime={report.reportDate}>
            <CalendarIcon />
            {formatReportDate(report.reportDate)}
          </time>
          <span className="report-card__like-count" title={`${report.likeCount ?? 0}件のいいね`}>
            <HeartIcon />
            {report.likeCount ?? 0}
          </span>
        </footer>
      </Link>
    </article>
  );
}

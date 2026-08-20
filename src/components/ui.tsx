/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { AlertIcon, ArrowLeftIcon, PlusIcon } from "@/components/icons";

export function Avatar({
  name,
  src,
  size = "medium",
}: {
  name: string;
  src?: string | null;
  size?: "small" | "medium" | "large";
}) {
  const initial = Array.from(name.trim())[0] || "H";
  return (
    <span aria-label={name} className={`avatar avatar--${size}`} role="img">
      {src ? <img alt="" src={src} /> : <span aria-hidden="true">{initial}</span>}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  backHref,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  backHref?: string;
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        {backHref ? (
          <Link className="back-link" href={backHref as Route}>
            <ArrowLeftIcon />
            戻る
          </Link>
        ) : null}
        <h1>{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingView({ label = "読み込んでいます" }: { label?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="loading-view">
      <span aria-hidden="true" className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title = "読み込めませんでした",
  message = "通信状態を確認して、もう一度お試しください。",
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-card state-card--error" role="alert">
      <span className="state-card__icon"><AlertIcon /></span>
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        {onRetry ? <button className="button button--secondary button--small" onClick={onRetry} type="button">もう一度試す</button> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  message,
  actionHref,
  actionLabel,
  icon,
}: {
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true" className="empty-state__icon">{icon || <span>✦</span>}</span>
      <h2>{title}</h2>
      <p>{message}</p>
      {actionHref && actionLabel ? (
        <Link className="button button--primary" href={actionHref as Route}>
          <PlusIcon />
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="日報を読み込んでいます" className="report-list">
      {Array.from({ length: count }, (_, index) => (
        <div className="report-card report-card--skeleton" key={index}>
          <span className="skeleton skeleton--short" />
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--line" />
          <span className="skeleton skeleton--medium" />
        </div>
      ))}
    </div>
  );
}

export function NewReportLink({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`button button--primary${compact ? " button--icon" : ""}`} href="/reports/new">
      <PlusIcon />
      {compact ? <span className="sr-only">日報を書く</span> : "日報を書く"}
    </Link>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTIVITY_AREAS, activityAreaClassName, type ActivityArea } from "@/lib/constants";
import { todayInJst } from "@/lib/text";
import type { ReportListItem, ReportPage } from "@/lib/types";
import { apiRequest } from "@/components/api-client";
import { ArrowRightIcon, CalendarIcon, PlusIcon } from "@/components/icons";
import { ReportCard } from "@/components/report-card";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui";

export function HomeScreen() {
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [area, setArea] = useState<ActivityArea | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: "published", limit: "50" });
      if (area) params.set("activityArea", area);
      const page = await apiRequest<ReportPage>(`/api/reports?${params}`, { signal });
      setReports(page.reports);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "日報を読み込めませんでした");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [area]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadReports(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadReports]);

  const today = todayInJst();
  const todayReports = useMemo(() => reports.filter((report) => report.reportDate === today), [reports, today]);
  const recentReports = useMemo(() => reports.filter((report) => report.reportDate !== today).slice(0, 8), [reports, today]);
  const dateLabel = new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date());

  return (
    <div className="page page--home">
      <header className="home-hero">
        <div>
          <p className="home-hero__date"><CalendarIcon />{dateLabel}</p>
          <h1>Hanabi Log</h1>
        </div>
        <Link className="button button--primary home-hero__action" href="/reports/new">
          <PlusIcon />
          日報を書く
        </Link>
      </header>

      <section aria-labelledby="today-heading" className="content-section">
        <div className="section-heading">
          <div>
            <h2 id="today-heading">今日の日報</h2>
          </div>
          <span className="section-heading__count">{loading ? "—" : `${todayReports.length}件`}</span>
        </div>

        <div aria-label="活動領域で絞り込む" className="filter-chips" role="group">
          <button aria-pressed={area === ""} className="filter-chip" onClick={() => setArea("")} type="button">すべて</button>
          {ACTIVITY_AREAS.map((item) => (
            <button aria-pressed={area === item} className={`filter-chip ${activityAreaClassName(item)}`} key={item} onClick={() => setArea(item)} type="button">{item}</button>
          ))}
        </div>

        {loading ? <SkeletonList count={2} /> : error ? (
          <ErrorState message={error} onRetry={() => void loadReports()} />
        ) : todayReports.length ? (
          <div className="report-list report-list--featured">
            {todayReports.map((report) => <ReportCard key={report.id} report={report} />)}
          </div>
        ) : (
          <EmptyState actionHref="/reports/new" actionLabel="日報を書く" title={area ? "この活動領域の日報はありません" : "今日の日報はありません"} />
        )}
      </section>

      <section aria-labelledby="recent-heading" className="content-section content-section--recent">
        <div className="section-heading">
          <div>
            <h2 id="recent-heading">最近の日報</h2>
          </div>
          <Link className="text-link" href="/archive">すべて見る<ArrowRightIcon /></Link>
        </div>
        {!loading && !error && recentReports.length ? (
          <div className="report-list">
            {recentReports.map((report) => <ReportCard key={report.id} report={report} />)}
          </div>
        ) : !loading && !error ? (
          <p className="muted-copy">最近の日報はありません。</p>
        ) : null}
      </section>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ACTIVITY_AREAS, CONTENT_CATEGORIES, THEME_TAGS } from "@/lib/constants";
import type { PublicMember, Report, ReportPage } from "@/lib/types";
import { apiRequest } from "@/components/api-client";
import { FilterIcon, SearchIcon, XIcon } from "@/components/icons";
import { ReportCard } from "@/components/report-card";
import { EmptyState, ErrorState, PageHeader, SkeletonList } from "@/components/ui";

interface SearchFilters {
  q: string;
  activityArea: string;
  contentCategory: string;
  themeTag: string;
  authorId: string;
  dateFrom: string;
  dateTo: string;
  status: string;
}

const initialFilters: SearchFilters = {
  q: "",
  activityArea: "",
  contentCategory: "",
  themeTag: "",
  authorId: "",
  dateFrom: "",
  dateTo: "",
  status: "published",
};

type ArchiveSearchParams = Record<string, string | string[] | undefined>;

function filtersFromSearchParams(params: ArchiveSearchParams): SearchFilters {
  const result = { ...initialFilters };
  (Object.keys(result) as (keyof SearchFilters)[]).forEach((key) => {
    const value = params[key];
    if (typeof value === "string") result[key] = value;
  });
  return result;
}

const filterLabels: Record<keyof SearchFilters, string> = {
  q: "キーワード",
  activityArea: "活動領域",
  contentCategory: "内容カテゴリ",
  themeTag: "テーマタグ",
  authorId: "投稿者",
  dateFrom: "開始日",
  dateTo: "終了日",
  status: "状態",
};

export function ArchiveScreen({ initialSearchParams = {} }: { initialSearchParams?: ArchiveSearchParams }) {
  const [form, setForm] = useState<SearchFilters>(() => filtersFromSearchParams(initialSearchParams));
  const [filters, setFilters] = useState<SearchFilters>(() => filtersFromSearchParams(initialSearchParams));
  const [reports, setReports] = useState<Report[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authors, setAuthors] = useState<PublicMember[]>([]);

  const loadReports = useCallback(async (cursor?: string, signal?: AbortSignal) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      (Object.entries(filters) as [keyof SearchFilters, string][]).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      if (cursor) params.set("cursor", cursor);
      const page = await apiRequest<ReportPage>(`/api/reports?${params}`, { signal });
      setReports((current) => cursor ? [...current, ...page.reports] : page.reports);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "検索結果を読み込めませんでした");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadReports(undefined, controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadReports]);

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<PublicMember[]>("/api/members", { signal: controller.signal })
      .then(setAuthors)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "投稿者を読み込めませんでした");
      });
    return () => controller.abort();
  }, []);

  const activeFilters = useMemo(() => (
    (Object.entries(filters) as [keyof SearchFilters, string][])
      .filter(([key, value]) => Boolean(value) && !(key === "status" && value === "published"))
  ), [filters]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ ...form });
    const params = new URLSearchParams();
    (Object.entries(form) as [keyof SearchFilters, string][]).forEach(([key, value]) => {
      if (value && !(key === "status" && value === "published")) params.set(key, value);
    });
    window.history.replaceState(null, "", params.size ? `/archive?${params}` : "/archive");
  }

  function removeFilter(key: keyof SearchFilters) {
    const fallback = key === "status" ? "published" : "";
    const next = { ...filters, [key]: fallback };
    setFilters(next);
    setForm(next);
  }

  function clearFilters() {
    setForm(initialFilters);
    setFilters(initialFilters);
    window.history.replaceState(null, "", "/archive");
  }

  function valueLabel(key: keyof SearchFilters, value: string): string {
    if (key === "authorId") return authors.find((author) => author.id === value)?.displayName || "投稿者";
    if (key === "status") return { draft: "下書き", published: "公開済み", archived: "アーカイブ" }[value] || value;
    return value;
  }

  return (
    <div className="page page--wide">
      <PageHeader description="活動領域やタグ、キーワードからチームの知見を見つけます。" title="日報をさがす" />

      <form className="search-layout" onSubmit={applyFilters}>
        <aside className="filter-panel">
          <div className="filter-panel__heading">
            <span><FilterIcon />絞り込み</span>
            <button className="text-button" onClick={clearFilters} type="button">すべてクリア</button>
          </div>
          <div className="field">
            <label htmlFor="archive-q">キーワード</label>
            <div className="input-with-icon">
              <SearchIcon />
              <input id="archive-q" maxLength={100} onChange={(event) => setForm({ ...form, q: event.target.value })} placeholder="タイトルや本文を検索" type="search" value={form.q} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="archive-area">活動領域</label>
            <select id="archive-area" onChange={(event) => setForm({ ...form, activityArea: event.target.value })} value={form.activityArea}>
              <option value="">すべて</option>
              {ACTIVITY_AREAS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="archive-category">内容カテゴリ</label>
            <select id="archive-category" onChange={(event) => setForm({ ...form, contentCategory: event.target.value })} value={form.contentCategory}>
              <option value="">すべて</option>
              {CONTENT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="archive-tag">テーマタグ</label>
            <select id="archive-tag" onChange={(event) => setForm({ ...form, themeTag: event.target.value })} value={form.themeTag}>
              <option value="">すべて</option>
              {THEME_TAGS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="archive-author">投稿者</label>
            <select id="archive-author" onChange={(event) => setForm({ ...form, authorId: event.target.value })} value={form.authorId}>
              <option value="">すべて</option>
              {authors.map((author) => <option key={author.id} value={author.id}>{author.displayName}</option>)}
            </select>
          </div>
          <fieldset className="field fieldset-reset">
            <legend>日付範囲</legend>
            <div className="date-range">
              <label><span className="sr-only">開始日</span><input max={form.dateTo || undefined} onChange={(event) => setForm({ ...form, dateFrom: event.target.value })} type="date" value={form.dateFrom} /></label>
              <span aria-hidden="true">—</span>
              <label><span className="sr-only">終了日</span><input min={form.dateFrom || undefined} onChange={(event) => setForm({ ...form, dateTo: event.target.value })} type="date" value={form.dateTo} /></label>
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="archive-status">状態</label>
            <select id="archive-status" onChange={(event) => setForm({ ...form, status: event.target.value })} value={form.status}>
              <option value="published">公開済み</option>
              <option value="archived">アーカイブ</option>
              <option value="draft">下書き（自分のみ）</option>
            </select>
          </div>
          <button className="button button--primary filter-panel__submit" type="submit"><SearchIcon />この条件で検索</button>
        </aside>

        <section aria-labelledby="results-heading" className="search-results">
          <div className="search-results__heading">
            <h2 id="results-heading">検索結果</h2>
            <span>{loading ? "検索中" : `${reports.length}件`}</span>
          </div>
          {activeFilters.length ? (
            <div aria-label="適用中の絞り込み" className="active-filters">
              {activeFilters.map(([key, value]) => (
                <button aria-label={`${filterLabels[key]}「${valueLabel(key, value)}」を解除`} key={key} onClick={() => removeFilter(key)} type="button">
                  <span>{filterLabels[key]}: {valueLabel(key, value)}</span><XIcon />
                </button>
              ))}
            </div>
          ) : null}

          {loading ? <SkeletonList /> : error ? (
            <ErrorState message={error} onRetry={() => void loadReports()} />
          ) : reports.length ? (
            <>
              <div className="report-list">
                {reports.map((report) => <ReportCard key={report.id} report={report} showStatus />)}
              </div>
              {nextCursor ? (
                <button className="button button--secondary load-more" disabled={loadingMore} onClick={() => void loadReports(nextCursor)} type="button">
                  {loadingMore ? "読み込んでいます…" : "さらに読み込む"}
                </button>
              ) : <p className="results-end">すべての結果を表示しました</p>}
            </>
          ) : (
            <EmptyState message="条件に一致する日報がありません。キーワードを短くするか、絞り込みを解除してみてください。" title="日報が見つかりませんでした" />
          )}
        </section>
      </form>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ContributionSummary, CurrentUser, LogRanking, LogRankingEntry, ReportListItem, ReportPage } from "@/lib/types";
import type { ReportStatus } from "@/lib/constants";
import { apiRequest } from "@/components/api-client";
import { ArrowRightIcon, PlusIcon, SettingsIcon } from "@/components/icons";
import { ReportCard } from "@/components/report-card";
import { ContributionGraph } from "@/components/contribution-graph";
import { LogRankingCard, LogRankingList } from "@/components/log-ranking";
import { Avatar, EmptyState, ErrorState, PageHeader, SkeletonList } from "@/components/ui";

const tabs: { value: ReportStatus; label: string }[] = [
  { value: "draft", label: "下書き" },
  { value: "pending_approval", label: "承認待ち" },
  { value: "published", label: "公開済み" },
  { value: "archived", label: "アーカイブ" },
];

export function MyScreen() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [reports, setReports] = useState<Record<ReportStatus, ReportListItem[]>>({ draft: [], pending_approval: [], published: [], archived: [] });
  const [tab, setTab] = useState<ReportStatus>("draft");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contributions, setContributions] = useState<ContributionSummary | null>(null);
  const [ranking, setRanking] = useState<LogRanking | null>(null);
  const [rankings, setRankings] = useState<LogRankingEntry[]>([]);
  const [view, setView] = useState<"reports" | "ranking">("reports");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const me = await apiRequest<CurrentUser>("/api/me", { signal });
      const [pages, contributionSummary, rankingSummary, rankingList] = await Promise.all([Promise.all(tabs.map(({ value }) => apiRequest<ReportPage>(
        `/api/reports?authorId=${encodeURIComponent(me.id)}&status=${value}&limit=50`,
        { signal },
      ))), apiRequest<ContributionSummary>("/api/me/contributions", { signal }).catch(() => null), apiRequest<LogRanking>(`/api/members/${me.id}/ranking`, { signal }).catch(() => null), apiRequest<LogRankingEntry[]>("/api/rankings", { signal }).catch(() => [])]);
      setUser(me);
      setReports({ draft: pages[0].reports, pending_approval: pages[1].reports, published: pages[2].reports, archived: pages[3].reports });
      setContributions(contributionSummary);
      setRanking(rankingSummary);
      setRankings(rankingList);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "マイページを読み込めませんでした");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  return (
    <div className="page">
      <PageHeader actions={<Link className="button button--primary" href="/reports/new"><PlusIcon />日報を書く</Link>} title="マイページ" />

      {error && !user ? <ErrorState message={error} onRetry={() => void load()} /> : (
        <>
          <section className="profile-card">
            <Avatar name={user?.displayName || "Hanabiメンバー"} size="large" src={user?.avatarUrl} />
            <div className="profile-card__copy">
              <div>
                <h2>{user?.displayName || "Hanabiメンバー"}</h2>
                <span className="role-badge">{user?.role === "admin" ? "Admin" : "Member"}</span>
                {user ? <span className={`member-activity-badge member-activity-badge--${user.isActive ? "active" : "inactive"}`}>{user.isActive ? "Active" : "Inactive・公開承認制"}</span> : null}
              </div>
            </div>
            <dl className="profile-stats">
              <div><dt>公開済み</dt><dd>{loading ? "—" : reports.published.length}</dd></div>
              <div><dt>下書き</dt><dd>{loading ? "—" : reports.draft.length}</dd></div>
              <div><dt>承認待ち</dt><dd>{loading ? "—" : reports.pending_approval.length}</dd></div>
            </dl>
            {user?.role === "admin" ? (
              <Link className="button button--secondary button--small" href="/admin"><SettingsIcon />管理画面</Link>
            ) : null}
          </section>

          <ContributionGraph summary={contributions} />

          <section aria-labelledby="my-reports-heading" className="content-section">
            <div aria-label="マイページ表示" className="tabs" role="tablist">
              <button aria-selected={view === "reports"} onClick={() => setView("reports")} role="tab" type="button">自分の日報</button>
              <button aria-selected={view === "ranking"} onClick={() => setView("ranking")} role="tab" type="button">Log Ranking</button>
            </div>
            {view === "ranking" ? <><LogRankingCard ranking={ranking} /><div className="section-heading"><h2>チーム順位</h2></div><LogRankingList entries={rankings} /></> : <>
            <div className="section-heading">
              <div>
                <h2 id="my-reports-heading">自分の日報</h2>
              </div>
            </div>
            <div aria-label="日報の状態" className="tabs" role="tablist">
              {tabs.map(({ value, label }) => (
                <button aria-controls={`panel-${value}`} aria-selected={tab === value} id={`tab-${value}`} key={value} onClick={() => setTab(value)} role="tab" type="button">
                  {label}<span>{reports[value].length}</span>
                </button>
              ))}
            </div>
            <div aria-labelledby={`tab-${tab}`} id={`panel-${tab}`} role="tabpanel" tabIndex={0}>
              {loading ? <SkeletonList count={2} /> : reports[tab].length ? (
                <div className="report-list">
                  {reports[tab].map((report) => <ReportCard key={report.id} report={report} showStatus />)}
                </div>
              ) : (
                <EmptyState
                  actionHref={tab === "draft" ? "/reports/new" : undefined}
                  actionLabel={tab === "draft" ? "日報を書く" : undefined}
                  title={tab === "draft" ? "下書きはありません" : tab === "pending_approval" ? "承認待ちの日報はありません" : tab === "published" ? "公開済みの日報はありません" : "アーカイブはありません"}
                />
              )}
            </div>
            </>}
          </section>

          <footer className="account-footer">
            <Link className="text-link" href="/api/auth/signout" prefetch={false}>Slackアカウントからログアウト<ArrowRightIcon /></Link>
          </footer>
        </>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { PublicMember, ReportListItem, ReportPage } from "@/lib/types";
import { apiRequest } from "@/components/api-client";
import { ArrowLeftIcon } from "@/components/icons";
import { ReportCard } from "@/components/report-card";
import { Avatar, EmptyState, ErrorState, LoadingView, PageHeader } from "@/components/ui";

export function MemberProfileScreen({ memberId }: { memberId: string }) {
  const [member, setMember] = useState<PublicMember | null>(null);
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const [loadedMember, page] = await Promise.all([
        apiRequest<PublicMember>(`/api/members/${memberId}`, { signal }),
        apiRequest<ReportPage>(`/api/reports?authorId=${encodeURIComponent(memberId)}&status=published&limit=50`, { signal }),
      ]);
      setMember(loadedMember);
      setReports(page.reports);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "メンバープロフィールを読み込めませんでした");
    }
  }, [memberId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!member && !error) return <div className="page"><LoadingView label="プロフィールを読み込んでいます" /></div>;
  if (!member) return <div className="page"><ErrorState message={error || "メンバーが見つかりません"} onRetry={() => void load()} /></div>;

  return <div className="page">
    <PageHeader actions={<Link className="back-link" href="/"><ArrowLeftIcon />ホームへ</Link>} title="メンバー" />
    <section className="profile-card">
      <Avatar name={member.displayName} size="large" src={member.avatarUrl} />
      <div className="profile-card__copy"><div><h2>{member.displayName}</h2><span className="role-badge">{member.role === "admin" ? "Admin" : "Member"}</span></div></div>
      <dl className="profile-stats"><div><dt>公開日報</dt><dd>{reports.length}</dd></div></dl>
    </section>
    <section aria-labelledby="member-reports-heading" className="content-section">
      <div className="section-heading"><h2 id="member-reports-heading">公開日報</h2></div>
      {reports.length ? <div className="report-list">{reports.map((report) => <ReportCard key={report.id} report={report} />)}</div> : <EmptyState message="公開されている日報はまだありません。" title="公開日報はありません" />}
    </section>
  </div>;
}

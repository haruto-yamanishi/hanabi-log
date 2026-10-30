"use client";
import Link from "next/link";
import { useState } from "react";
import type { UsageAnalytics } from "@/lib/analytics";
import { formatDateTime } from "@/components/report-card";
export function AdminUsagePanel({ data }: { data: UsageAnalytics | null }) {
  const [query, setQuery] = useState("");
  if (!data) return <p>利用状況を読み込み中…</p>;
  const reports = [...data.reports].filter(report => `${report.title} ${report.authorName}`.toLocaleLowerCase("ja").includes(query.toLocaleLowerCase("ja"))).sort((a, b) => b.views - a.views);
  return <section className="admin-panel" aria-labelledby="usage-heading">
    <div className="admin-panel__heading"><div><h2 id="usage-heading">利用状況</h2><p>{formatDateTime(data.startedAt)}から計測。30秒ごとに表示を更新します。</p></div></div>
    <div className="usage-summary"><p>オンライン <strong>{data.members.filter(member => member.online).length}人</strong></p><p>日報の総PV <strong>{data.reports.reduce((sum, report) => sum + report.views, 0)}</strong></p></div>
    <p className="admin-footnote">オンラインは直近2分以内に表示中のタブから通信があった状態です。メンバー別の状態は「メンバー」タブで確認できます。</p>
    <div className="field"><label htmlFor="usage-search">日報・投稿者を検索</label><input id="usage-search" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>日報</th><th>投稿者</th><th>PV</th><th>閲覧者数</th></tr></thead><tbody>{reports.map(report => <tr key={report.id}><td><Link href={`/reports/${report.id}`}>{report.title}</Link></td><td>{report.authorName}</td><td>{report.views}</td><td>{report.viewers}</td></tr>)}</tbody></table></div>
    {!reports.length ? <p>該当する日報はありません。</p> : null}
    <p className="admin-footnote">PVはログインした人が日報詳細を開いた回数です。再読み込み・投稿者自身の閲覧も含みます。閲覧者数は日報ごとの人数で、同じ人は1人と数えます。計測開始前の閲覧は含まれません。</p>
  </section>;
}

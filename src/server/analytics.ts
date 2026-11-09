import "server-only";
import { getDatabase } from "@/server/db/client";
import { isDemoMode } from "@/server/env";
import { getReportRepository } from "@/server/repositories";
import type { CurrentUser } from "@/lib/types";
import type { UsageAnalytics } from "@/lib/analytics";

const demo = globalThis as typeof globalThis & { __hanabiUsage?: { startedAt: string; presence: Map<string, string>; visits: Map<string, { reportId: string; memberId: string }> } };
function demoUsage() { return demo.__hanabiUsage ??= { startedAt: new Date().toISOString(), presence: new Map(), visits: new Map() }; }
export async function recordPresence(memberId: string) {
  if (isDemoMode) { demoUsage().presence.set(memberId, new Date().toISOString()); return; }
  await getDatabase()`insert into member_presence (member_id) values (${memberId}) on conflict (member_id) do update set last_seen_at = now()`;
}
export async function recordReportView(reportId: string, memberId: string, visitId: string) {
  if (isDemoMode) { if (!demoUsage().visits.has(visitId)) demoUsage().visits.set(visitId, { reportId, memberId }); return; }
  await getDatabase()`insert into report_page_views (visit_id, report_id, member_id) values (${visitId}, ${reportId}, ${memberId}) on conflict (visit_id) do nothing`;
}
export async function getUsageAnalytics(actor: CurrentUser): Promise<UsageAnalytics> {
  if (isDemoMode) {
    const state = demoUsage();
    const repository = getReportRepository();
    const members = await repository.listMembers();
    const reports = [];
    for (const id of new Set([...state.visits.values()].map(visit => visit.reportId))) {
      const report = await repository.getReadableReport(id, actor);
      if (!report) continue;
      const visits = [...state.visits.values()].filter(visit => visit.reportId === id);
      reports.push({ id, title: report.title, authorName: report.author.displayName, views: visits.length, viewers: new Set(visits.map(visit => visit.memberId)).size });
    }
    return { startedAt: state.startedAt, members: members.map(member => ({ id: member.id, registeredAt: member.createdAt, lastSeenAt: state.presence.get(member.id) ?? null, online: Date.now() - Date.parse(state.presence.get(member.id) ?? "") < 120_000 })), reports };
  }
  const sql = getDatabase();
  const [members, reports, settings] = await Promise.all([
    sql`select m.id, m.created_at, p.last_seen_at, coalesce(p.last_seen_at > now() - interval '2 minutes', false) as online from members m left join member_presence p on p.member_id = m.id order by m.created_at, m.id`,
    sql`select r.id, r.title, m.display_name, count(v.visit_id)::int as views, count(distinct v.member_id)::int as viewers from reports r join members m on m.id = r.author_id left join report_page_views v on v.report_id = r.id where r.status in ('published', 'archived') group by r.id, m.display_name order by count(v.visit_id) desc, r.created_at desc, r.id`,
    sql`select started_at from analytics_settings where id = true`,
  ]);
  return {
    startedAt: new Date(settings[0].started_at).toISOString(),
    members: members.map(member => ({ id: member.id, registeredAt: new Date(member.created_at).toISOString(), lastSeenAt: member.last_seen_at ? new Date(member.last_seen_at).toISOString() : null, online: member.online })),
    reports: reports.map(report => ({ id: report.id, title: report.title, authorName: report.display_name, views: report.views, viewers: report.viewers })),
  };
}

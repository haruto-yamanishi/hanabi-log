"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ACTIVITY_AREAS, CONTENT_CATEGORIES, THEME_TAGS, type DeliveryTarget, type ReportStatus } from "@/lib/constants";
import type { CurrentUser, MemberRole, PublicMember, Report, ReportPage } from "@/lib/types";
import { apiRequest } from "@/components/api-client";
import { AlertIcon, ArrowRightIcon, CheckIcon, RefreshIcon, SettingsIcon, TrashIcon, UserIcon } from "@/components/icons";
import { formatDateTime } from "@/components/report-card";
import { Avatar, EmptyState, ErrorState, LoadingView, PageHeader } from "@/components/ui";

type AdminTab = "sync" | "members" | "categories";

const problemStatuses = new Set(["failed", "dead", "partial"]);

interface SyncIssue {
  report: Report;
  target: DeliveryTarget;
  status: string;
  error?: string | null;
}

interface NotionConnectionStatus {
  connected: boolean;
  available?: boolean;
  workspaceId?: string;
  workspaceName?: string | null;
  ownerUserName?: string | null;
  connectedAt?: string;
  updatedAt?: string;
}

function initialNotionNotice(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const result = params.get("notion");
  if (result === "connected") return "Notionワークスペースを接続しました。";
  if (result === "cancelled") return "Notion接続はキャンセルされました。";
  if (result === "error") {
    return params.get("reason") === "NOTION_DATABASE_NOT_SHARED"
      ? "Notionの許可画面で「HANABI LOG｜日報アーカイブ」を選択してください。"
      : "Notionを接続できませんでした。設定を確認して再度お試しください。";
  }
  return null;
}

async function loadAllReports(status: ReportStatus, signal?: AbortSignal): Promise<Report[]> {
  const reports: Report[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ status, limit: "50" });
    if (cursor) params.set("cursor", cursor);
    const page = await apiRequest<ReportPage>(`/api/reports?${params}`, { signal });
    reports.push(...page.reports);
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);
  return reports;
}

export function AdminScreen() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [members, setMembers] = useState<PublicMember[]>([]);
  const [notionConnection, setNotionConnection] = useState<NotionConnectionStatus>({ connected: false });
  const [tab, setTab] = useState<AdminTab>("sync");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotionNotice);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [me, loadedMembers, published, archived, loadedNotionConnection] = await Promise.all([
        apiRequest<CurrentUser>("/api/me", { signal }),
        apiRequest<PublicMember[]>("/api/members", { signal }),
        loadAllReports("published", signal),
        loadAllReports("archived", signal),
        apiRequest<NotionConnectionStatus>("/api/integrations/notion", { signal }),
      ]);
      setUser(me);
      setMembers(loadedMembers);
      setReports([...published, ...archived]);
      setNotionConnection(loadedNotionConnection);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "管理情報を読み込めませんでした");
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("notion")) return;
    params.delete("notion");
    params.delete("reason");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  const issues = useMemo<SyncIssue[]>(() => reports.flatMap((report) => {
    if (!report.integration) return [];
    const result: SyncIssue[] = [];
    if (problemStatuses.has(report.integration.slackStatus)) {
      result.push({ report, target: "slack", status: report.integration.slackStatus, error: report.integration.slackLastError });
    }
    if (problemStatuses.has(report.integration.notionStatus)) {
      result.push({ report, target: "notion", status: report.integration.notionStatus, error: report.integration.notionLastError });
    }
    return result;
  }), [reports]);

  async function retry(issue: SyncIssue) {
    const key = `${issue.report.id}-${issue.target}`;
    setRetrying(key);
    setNotice(null);
    try {
      const updated = await apiRequest<Report>(`/api/reports/${issue.report.id}/integrations/${issue.target}/retry`, { method: "POST" });
      setReports((current) => current.map((report) => report.id === updated.id ? updated : report));
      setNotice(`${issue.target === "slack" ? "Slack配信" : "Notion同期"}を再試行キューへ追加しました。`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "再試行を開始できませんでした");
    } finally {
      setRetrying(null);
    }
  }

  async function updateMemberRole(member: PublicMember, event: ChangeEvent<HTMLSelectElement>) {
    const role = event.target.value as MemberRole;
    if (role === member.role) return;
    setUpdatingMemberId(member.id);
    setNotice(null);
    try {
      const updated = await apiRequest<PublicMember>(`/api/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setMembers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(`${updated.displayName}さんの権限を${updated.role === "admin" ? "Admin" : "Member"}へ変更しました。`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "権限を変更できませんでした");
    } finally {
      setUpdatingMemberId(null);
    }
  }

  async function deleteMember(member: PublicMember) {
    if (member.id === user?.id) return;
    if (!window.confirm(`${member.displayName}さんをメンバー一覧から削除しますか？\n日報を書いたことがあるメンバーは、記録保護のため削除できません。`)) return;
    setUpdatingMemberId(member.id);
    setNotice(null);
    try {
      await apiRequest<Record<string, never>>(`/api/members/${member.id}`, {
        method: "DELETE",
      });
      setMembers((current) => current.filter((item) => item.id !== member.id));
      setNotice(`${member.displayName}さんを削除しました。`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "メンバーを削除できませんでした");
    } finally {
      setUpdatingMemberId(null);
    }
  }

  async function disconnectNotion() {
    if (!window.confirm("Notionとの接続を解除しますか？ 日報データは削除されません。")) return;
    setNotice(null);
    try {
      await apiRequest<Record<string, never>>("/api/integrations/notion", { method: "DELETE" });
      setNotionConnection({ connected: false, available: true });
      setNotice("Notionとの接続を解除しました。");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Notion接続を解除できませんでした");
    }
  }

  if (!loading && user && user.role !== "admin") {
    return (
      <div className="page">
        <PageHeader title="管理" />
        <ErrorState message="この画面はAdminだけが利用できます。" title="アクセス権限がありません" />
      </div>
    );
  }

  return (
    <div className="page page--wide">
      <PageHeader description="同期状態、メンバー、分類を確認します。" title="管理" />
      {loading ? <LoadingView label="管理情報を読み込んでいます" /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : (
        <>
          <section aria-label="システム概要" className="admin-stats">
            <div><span className="admin-stats__icon admin-stats__icon--error"><AlertIcon /></span><p>要対応の同期</p><strong>{issues.length}</strong><small>Slack / Notion</small></div>
            <div><span className="admin-stats__icon"><UserIcon /></span><p>登録メンバー</p><strong>{members.length}</strong><small>Slackログイン済み</small></div>
            <div><span className="admin-stats__icon admin-stats__icon--success"><CheckIcon /></span><p>同期正常率</p><strong>{reports.length ? `${Math.round(((reports.length * 2 - issues.length) / (reports.length * 2)) * 100)}%` : "—"}</strong><small>直近{reports.length}件</small></div>
          </section>

          <div aria-label="管理メニュー" className="admin-tabs" role="tablist">
            <button aria-selected={tab === "sync"} onClick={() => setTab("sync")} role="tab" type="button"><RefreshIcon />同期管理{issues.length ? <span>{issues.length}</span> : null}</button>
            <button aria-selected={tab === "members"} onClick={() => setTab("members")} role="tab" type="button"><UserIcon />メンバー</button>
            <button aria-selected={tab === "categories"} onClick={() => setTab("categories")} role="tab" type="button"><SettingsIcon />分類設定</button>
          </div>

          {notice ? <div aria-live="polite" className="notice-banner"><CheckIcon />{notice}</div> : null}

          {tab === "sync" ? (
            <section aria-labelledby="sync-heading" className="admin-panel">
              <div className="integration-connection-card">
                <span className="integration-logo integration-logo--notion">N</span>
                <div className="integration-connection-card__copy">
                  <div><strong>Notion</strong>{notionConnection.connected ? <span className="sync-pill sync-pill--success"><CheckIcon />接続済み</span> : <span className="sync-pill sync-pill--warning">未接続</span>}</div>
                  <p>
                    {notionConnection.connected
                      ? `${notionConnection.workspaceName || "Notionワークスペース"}へ日報を同期します。`
                      : notionConnection.available === false
                        ? "実運用モードへ切り替えた後にOAuth接続できます。"
                        : "OAuthで日報アーカイブへのアクセスを許可してください。"}
                  </p>
                  {notionConnection.connectedAt ? <small>接続 {formatDateTime(notionConnection.connectedAt)}</small> : null}
                </div>
                {notionConnection.available === false ? null : (
                  <div className="integration-connection-card__actions">
                    <a className="button button--secondary button--small" href="/api/integrations/notion/connect">
                      {notionConnection.connected ? "再接続" : "Notionを接続"}
                    </a>
                    {notionConnection.connected ? <button className="button button--ghost button--small" onClick={() => void disconnectNotion()} type="button">解除</button> : null}
                  </div>
                )}
              </div>
              <div className="admin-panel__heading"><div><h2 id="sync-heading">失敗した同期</h2><p>日報は公開されたままです。外部サービスへの配信だけを再試行します。</p></div></div>
              {issues.length ? (
                <div className="sync-list">
                  {issues.map((issue) => {
                    const key = `${issue.report.id}-${issue.target}`;
                    return (
                      <article className="sync-issue" key={key}>
                        <span className={`integration-logo integration-logo--${issue.target}`}>{issue.target === "slack" ? "S" : "N"}</span>
                        <div className="sync-issue__body">
                          <div className="sync-issue__title">
                            <span className="status-badge status-badge--error">{issue.status === "dead" ? "手動対応" : issue.status === "partial" ? "一部失敗" : "失敗"}</span>
                            <span>{issue.target === "slack" ? "Slack配信" : "Notion同期"}</span>
                          </div>
                          <Link href={`/reports/${issue.report.id}`}>{issue.report.title}<ArrowRightIcon /></Link>
                          <p>{issue.error || "外部サービスからエラーが返されました"}</p>
                          <small>更新 {formatDateTime(issue.report.integration?.updatedAt || issue.report.updatedAt)}</small>
                        </div>
                        <button className="button button--secondary button--small" disabled={retrying === key} onClick={() => void retry(issue)} type="button"><RefreshIcon />{retrying === key ? "再試行中…" : "再試行"}</button>
                      </article>
                    );
                  })}
                </div>
              ) : <EmptyState message="SlackとNotionへの配信は正常です。手動対応が必要な日報はありません。" title="すべて正常に同期されています" />}
            </section>
          ) : null}

          {tab === "members" ? (
            <section aria-labelledby="members-heading" className="admin-panel">
              <div className="admin-panel__heading"><div><h2 id="members-heading">メンバー</h2><p>ログイン済みの全メンバーと現在の権限です。</p></div></div>
              <div className="member-list">
                {members.map((member) => (
                  <article className="member-row" key={member.id}>
                    <Avatar name={member.displayName} src={member.avatarUrl} />
                    <div><strong>{member.displayName}</strong><span>{member.id === user?.id ? "ログイン中のアカウント" : "チームメンバー"}</span></div>
                    <label>
                      <span className="sr-only">{member.displayName}さんの権限</span>
                      <select
                        aria-label={`${member.displayName}さんの権限`}
                        disabled={updatingMemberId === member.id}
                        onChange={(event) => void updateMemberRole(member, event)}
                        value={member.role}
                      >
                        <option disabled={member.id === user?.id} value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                    <button
                      aria-label={`${member.displayName}さんを削除`}
                      className="button button--ghost button--icon button--small button--danger"
                      disabled={member.id === user?.id || updatingMemberId === member.id}
                      onClick={() => void deleteMember(member)}
                      title={member.id === user?.id ? "自分自身は削除できません" : "メンバーを削除"}
                      type="button"
                    >
                      <TrashIcon />
                    </button>
                  </article>
                ))}
              </div>
              <p className="admin-footnote">新しいメンバーは、対象Slackワークスペースから初回ログインしたときに追加されます。日報を書いたメンバーは過去の記録を残すため削除できません。</p>
            </section>
          ) : null}

          {tab === "categories" ? (
            <section aria-labelledby="categories-heading" className="admin-panel">
              <div className="admin-panel__heading"><div><h2 id="categories-heading">分類設定</h2><p>Webアプリ、Slack、Notionで共通して使う分類です。</p></div></div>
              <div className="classification-grid">
                <ClassificationGroup items={ACTIVITY_AREAS} title="活動領域" />
                <ClassificationGroup items={CONTENT_CATEGORIES} title="内容カテゴリ" />
                <ClassificationGroup items={THEME_TAGS} title="テーマタグ" />
              </div>
              <p className="admin-footnote">MVPでは同期の整合性を守るため、分類は共通定義として固定されています。</p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ClassificationGroup({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section className="classification-group">
      <div><h3>{title}</h3><span>{items.length}件</span></div>
      <ul>{items.map((item) => <li key={item}><span>{item}</span><CheckIcon /></li>)}</ul>
    </section>
  );
}

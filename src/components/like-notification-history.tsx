"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/components/api-client";
import { formatDateTime } from "@/components/report-card";
import { slackDisplayText, type SystemDmHistory } from "@/lib/system-dm-history";

const labels = { sent: "送信済み", failed: "送信失敗", processing: "送信中", pending: "送信待ち", unknown: "送信結果の確認が必要" };

export function LikeNotificationHistoryPanel() {
  const [items, setItems] = useState<SystemDmHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<SystemDmHistory[]>("/api/integrations/slack/notifications", { signal });
      if (!signal?.aborted) setItems(result);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "通知履歴を取得できませんでした");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [load]);

  return (
    <section aria-labelledby="dm-history-heading">
      <div className="admin-panel__heading">
        <div><h2 id="dm-history-heading">システムのDM送信履歴</h2><p>いいね通知・活動リマインド・お知らせをまとめて最新100件表示します。</p></div>
        <button className="button button--secondary button--small" disabled={loading} onClick={() => void load()} type="button">{loading ? "読み込み中…" : "履歴を更新"}</button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error && !items.length ? <p>通知履歴はまだありません。</p> : null}
      <div className="sync-list">
        {items.map((item) => (
          <article className="sync-issue" key={item.id}>
            <div className="sync-issue__body" style={{ display: "grid", gap: "0.75rem" }}>
              <div className="sync-issue__title"><strong>{item.recipientName} 宛て</strong><span>{labels[item.status]}</span></div>
              <small>Slack ID: {item.recipientSlackUserId}{!item.recipientRecorded ? "（現在の登録情報・送信時の宛先記録なし）" : ""}</small>
              <span>{{ like: "いいね通知", contribution_nudge: "活動リマインド", announcement: "お知らせ", publication: "掲載許可", role_change: "権限変更" }[item.kind]}</span>
              {item.reportId ? <Link href={`/reports/${item.reportId}`} prefetch={false}>{slackDisplayText(item.reportTitle ?? "日報を見る")}</Link> : null}
              {item.messageText ? <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit" }}>{item.messageText.split(/(<https?:\/\/[^<>]+>)/g).map((part, index) => {
                  const link = /^<(https?:\/\/[^<>|]+)(?:\|([^<>]*))?>$/.exec(part);
                  return link ? <a key={index} href={slackDisplayText(link[1])} target="_blank" rel="noopener noreferrer">{slackDisplayText(link[2] ?? link[1])}</a> : slackDisplayText(part);
                })}</pre>
                : <p>{item.status === "sent" ? "この通知は本文の記録開始前に送信されたため、送信内容は保存されていません。" : "送信内容は送信処理の開始時に記録されます。"}</p>}
              {item.sentAt ? <small>送信日時：{formatDateTime(item.sentAt)}</small> : item.attemptedAt ? <small>最終試行：{formatDateTime(item.attemptedAt)}</small> : null}
              {item.error ? <p>エラー：{item.error}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

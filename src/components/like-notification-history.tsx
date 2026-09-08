"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/components/api-client";
import { formatDateTime } from "@/components/report-card";
import type { LikeNotificationHistory } from "@/lib/like-notification-history";

const labels = { sent: "送信済み", failed: "送信失敗・再試行待ち", processing: "送信中", pending: "送信待ち" };

export function LikeNotificationHistoryPanel() {
  const [items, setItems] = useState<LikeNotificationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<LikeNotificationHistory[]>("/api/integrations/slack/notifications", { signal });
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
        <div><h2 id="dm-history-heading">いいねのDM通知履歴</h2><p>最新100件。複数の節目をまとめたDMは1件で表示します。</p></div>
        <button className="button button--secondary button--small" disabled={loading} onClick={() => void load()} type="button">{loading ? "読み込み中…" : "履歴を更新"}</button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error && !items.length ? <p>通知履歴はまだありません。</p> : null}
      <div className="sync-list">
        {items.map((item, index) => (
          <article className="sync-issue" key={`${item.reportId}-${item.thresholds.join("-")}-${index}`}>
            <div className="sync-issue__body">
              <div className="sync-issue__title"><strong>{item.recipientName} 宛て</strong><span>{labels[item.status]}</span></div>
              <small>Slack ID: {item.recipientSlackUserId}{!item.recipientRecorded ? "（現在の日報投稿者・送信時の宛先記録なし）" : ""}</small>
              <Link href={`/reports/${item.reportId}`} prefetch={false}>{item.reportTitle}</Link>
              <p>通知対象：{item.thresholds.join("・")}人超え</p>
              {item.messageText ? <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit" }}>{item.messageText}</pre>
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

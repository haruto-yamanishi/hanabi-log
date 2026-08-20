"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { apiRequest } from "@/components/api-client";
import { ExternalLinkIcon, RefreshIcon } from "@/components/icons";
import { formatDateTime } from "@/components/report-card";
import { Avatar } from "@/components/ui";
import type { ReportComment, ReportCommentsResult } from "@/lib/types";

export function ReportComments({
  reportId,
  slackUrl,
  canPost,
}: {
  reportId: string;
  slackUrl?: string | null;
  canPost: boolean;
}) {
  const [comments, setComments] = useState<ReportComment[]>([]);
  const [available, setAvailable] = useState(Boolean(slackUrl));
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal, manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<ReportCommentsResult>(
        `/api/reports/${reportId}/comments`,
        { signal },
      );
      setComments(result.comments);
      setAvailable(result.available);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "コメントを読み込めませんでした");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [reportId]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = body.trim();
    if (!value || posting || !available || !canPost) return;
    setPosting(true);
    setError(null);
    try {
      const comment = await apiRequest<ReportComment>(
        `/api/reports/${reportId}/comments`,
        { method: "POST", body: JSON.stringify({ body: value }) },
      );
      setComments((current) => current.some((item) => item.id === comment.id)
        ? current
        : [...current, comment]);
      setBody("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "コメントを投稿できませんでした");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section aria-labelledby="comments-heading" className="report-comments">
      <div className="report-comments__heading">
        <div>
          <h2 id="comments-heading">コメント <span>{comments.length}</span></h2>
          <p>Slackスレッドと同期しています。</p>
        </div>
        <button
          className="button button--ghost button--small"
          disabled={loading || refreshing}
          onClick={() => void load(undefined, true)}
          type="button"
        >
          <RefreshIcon />{refreshing ? "更新中" : "更新"}
        </button>
      </div>

      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {loading ? (
        <p className="report-comments__state">コメントを読み込んでいます…</p>
      ) : !available ? (
        <p className="report-comments__state">Slackへの同期が完了するとコメントできます。</p>
      ) : comments.length ? (
        <ol className="comment-list">
          {comments.map((comment) => (
            <li className="comment-item" key={comment.id}>
              <Avatar name={comment.author.displayName} src={comment.author.avatarUrl} />
              <div className="comment-item__body">
                <div className="comment-item__meta">
                  <strong>{comment.author.displayName}</strong>
                  <span>{comment.source === "web" ? "WEB" : "Slack"}</span>
                  <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
                </div>
                <p>{comment.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="report-comments__state">コメントはまだありません。</p>
      )}

      {canPost ? (
        <form className="comment-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="report-comment">コメントを書く</label>
          <textarea
            disabled={!available || posting}
            id="report-comment"
            maxLength={2_000}
            onChange={(event) => setBody(event.target.value)}
            placeholder="コメントを入力"
            rows={4}
            value={body}
          />
          <div>
            <span>{body.length} / 2000</span>
            <button
              className="button button--primary"
              disabled={!available || posting || !body.trim()}
              type="submit"
            >
              {posting ? "投稿中…" : "Slackにも投稿"}
            </button>
          </div>
        </form>
      ) : null}

      {slackUrl ? (
        <a className="report-comments__slack-link" href={slackUrl} rel="noreferrer" target="_blank">
          Slackでスレッドを開く<ExternalLinkIcon />
        </a>
      ) : null}
    </section>
  );
}

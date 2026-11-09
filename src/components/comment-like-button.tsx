"use client";
import { useState } from "react";
import { apiRequest } from "@/components/api-client";
import { HeartIcon } from "@/components/icons";
import type { ReportComment } from "@/lib/types";

export function CommentLikeButton({ reportId, comment, disabled }: { reportId: string; comment: ReportComment; disabled: boolean }) {
  const [state, setState] = useState({ likeCount: comment.likeCount ?? 0, likedByCurrentUser: comment.likedByCurrentUser ?? false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setState(await apiRequest<typeof state>(`/api/reports/${reportId}/comments/${encodeURIComponent(comment.id)}/like`, { method: state.likedByCurrentUser ? "DELETE" : "PUT" }));
      window.dispatchEvent(new CustomEvent("hanabi-report-likes-changed", { detail: { reportId } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "いいねを更新できませんでした"); }
    finally { setBusy(false); }
  }
  return <div className="comment-like">
    <button type="button" className="comment-like__button" aria-label={`${comment.author.displayName}のコメントにいいね`} aria-pressed={state.likedByCurrentUser} disabled={disabled || busy} onClick={() => void toggle()}>
      <HeartIcon /><span>{state.likedByCurrentUser ? "いいね済み" : "いいね"}</span><strong>{state.likeCount}</strong>
    </button>
    {error ? <small role="alert">{error}</small> : null}
  </div>;
}

"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/components/api-client";
import { HeartIcon } from "@/components/icons";
import { Avatar } from "@/components/ui";
import type { CurrentUser, Report, ReportLikeSummary, ReportLiker } from "@/lib/types";

export function ReportLikeButton({
  reportId,
  initialCount = 0,
  initialLiked = false,
  initialLikedBy = [],
}: {
  reportId: string;
  initialCount?: number;
  initialLiked?: boolean;
  initialLikedBy?: ReportLiker[];
  currentUser: CurrentUser;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [likedBy, setLikedBy] = useState(initialLikedBy);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function refresh(event: Event) {
      if ((event as CustomEvent<{ reportId: string }>).detail?.reportId !== reportId) return;
      void apiRequest<Report>(`/api/reports/${reportId}`).then(report => {
        setCount(report.likeCount ?? 0);
        setLiked(report.likedByCurrentUser ?? false);
        setLikedBy(report.likedBy ?? []);
      }).catch(() => undefined);
    }
    window.addEventListener("hanabi-report-likes-changed", refresh);
    return () => window.removeEventListener("hanabi-report-likes-changed", refresh);
  }, [reportId]);

  async function toggleLike() {
    if (acting) return;
    const nextLiked = !liked;
    setActing(true);
    setError(null);

    try {
      const result = await apiRequest<ReportLikeSummary>(`/api/reports/${reportId}/like`, {
        method: nextLiked ? "PUT" : "DELETE",
        keepalive: true,
      });
      setLiked(result.liked);
      setCount(result.likeCount);
      setLikedBy(result.likedBy);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "いいねを更新できませんでした");
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="report-like">
      <button
        aria-pressed={liked}
        className="report-like__button"
        disabled={acting}
        onClick={() => void toggleLike()}
        type="button"
      >
        <HeartIcon />
        <span>{liked ? "いいね済み" : "いいね"}</span>
        <strong aria-label={`${count}件`}>{count}</strong>
      </button>
      {likedBy.length ? (
        <ul aria-label="いいねしたメンバー" className="report-like__members">
          {likedBy.map((member) => (
            <li key={member.id}>
              <Avatar name={member.displayName} size="small" src={member.avatarUrl} />
              <span>{member.displayName}</span>
            </li>
          ))}
        </ul>
      ) : <small className="report-like__empty">まだいいねはありません</small>}
      <small>日報・コメントのSlackスタンプとWebのいいねを合わせて1人1件。解除は押したサービス側で行えます。</small>
      {error ? <small className="report-like__error" role="alert">{error}</small> : null}
    </div>
  );
}

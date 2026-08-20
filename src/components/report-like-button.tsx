"use client";

import { useState } from "react";
import { apiRequest } from "@/components/api-client";
import { HeartIcon } from "@/components/icons";
import { Avatar } from "@/components/ui";
import type { CurrentUser, ReportLikeSummary, ReportLiker } from "@/lib/types";

export function ReportLikeButton({
  reportId,
  initialCount = 0,
  initialLiked = false,
  initialLikedBy = [],
  currentUser,
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

  async function toggleLike() {
    if (acting) return;
    const nextLiked = !liked;
    const previousCount = count;
    const previousLikedBy = likedBy;
    setLiked(nextLiked);
    setCount(Math.max(0, count + (nextLiked ? 1 : -1)));
    setLikedBy((members) =>
      nextLiked
        ? members.some((member) => member.id === currentUser.id)
          ? members
          : [...members, {
              id: currentUser.id,
              displayName: currentUser.displayName,
              avatarUrl: currentUser.avatarUrl,
            }]
        : members.filter((member) => member.id !== currentUser.id),
    );
    setActing(true);
    setError(null);

    try {
      const result = await apiRequest<ReportLikeSummary>(`/api/reports/${reportId}/like`, {
        method: nextLiked ? "PUT" : "DELETE",
      });
      setLiked(result.liked);
      setCount(result.likeCount);
      setLikedBy(result.likedBy);
    } catch (cause) {
      setLiked(!nextLiked);
      setCount(previousCount);
      setLikedBy(previousLikedBy);
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
      {error ? <small className="report-like__error" role="alert">{error}</small> : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { apiRequest } from "@/components/api-client";
import { HeartIcon } from "@/components/icons";
import type { ReportLikeSummary } from "@/lib/types";

export function ReportLikeButton({
  reportId,
  initialCount = 0,
  initialLiked = false,
}: {
  reportId: string;
  initialCount?: number;
  initialLiked?: boolean;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleLike() {
    if (acting) return;
    const nextLiked = !liked;
    const previousCount = count;
    setLiked(nextLiked);
    setCount(Math.max(0, count + (nextLiked ? 1 : -1)));
    setActing(true);
    setError(null);

    try {
      const result = await apiRequest<ReportLikeSummary>(`/api/reports/${reportId}/like`, {
        method: nextLiked ? "PUT" : "DELETE",
      });
      setLiked(result.liked);
      setCount(result.likeCount);
    } catch (cause) {
      setLiked(!nextLiked);
      setCount(previousCount);
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
      {error ? <small className="report-like__error" role="alert">{error}</small> : null}
    </div>
  );
}

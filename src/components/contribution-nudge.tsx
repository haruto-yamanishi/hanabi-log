"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRightIcon, PlusIcon, XIcon } from "@/components/icons";
import type { ContributionSummary } from "@/lib/types";
import { todayInJst } from "@/lib/text";

const INACTIVITY_WINDOW_DAYS = 14;

function shiftDateKey(dateKey: string, offsetDays: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function ContributionNudge({ userId, summary }: { userId: string; summary: ContributionSummary }) {
  const state = useMemo(() => {
    const today = todayInJst();
    const cutoff = shiftDateKey(today, -(INACTIVITY_WINDOW_DAYS - 1));
    const daysWithActivity = summary.days.filter((day) => day.count > 0 && day.date <= today);
    const hasRecentActivity = daysWithActivity.some((day) => day.date >= cutoff);
    const lastContributionDate = daysWithActivity.reduce<string | null>(
      (latest, day) => (!latest || day.date > latest ? day.date : latest),
      null,
    );

    return {
      inactive: !hasRecentActivity,
      episodeKey: lastContributionDate ?? "no-contribution",
    };
  }, [summary]);

  const storageKey = `hanabi-log:contribution-nudge:${userId}:${state.episodeKey}`;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!state.inactive) {
      setDismissed(true);
      return;
    }

    try {
      setDismissed(window.localStorage.getItem(storageKey) === "dismissed");
    } catch {
      setDismissed(false);
    }
  }, [state.inactive, storageKey]);

  if (!state.inactive || dismissed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(storageKey, "dismissed");
    } catch {
      // Keep dismissal functional for this render even when storage is unavailable.
    }
    setDismissed(true);
  };

  return (
    <aside aria-label="活動リマインダー" className="contribution-nudge">
      <div className="contribution-nudge__copy">
        <strong>ここ2週間、日報・コメントの記録がありません。</strong>
        <p>最近やったことを日報に残すか、誰かの日報にコメントしてみてください。</p>
      </div>
      <div className="contribution-nudge__actions">
        <Link className="button button--primary button--small" href="/reports/new">
          <PlusIcon />
          日報を書く
        </Link>
        <Link className="text-link" href="/archive">
          コメントする日報を探す
          <ArrowRightIcon />
        </Link>
      </div>
      <button aria-label="この案内を閉じる" className="contribution-nudge__dismiss" onClick={dismiss} type="button">
        <XIcon />
      </button>
    </aside>
  );
}

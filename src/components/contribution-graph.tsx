"use client";

import type { ContributionSummary } from "@/lib/types";

export function ContributionGraph({ summary, headingId = "contributions-heading" }: { summary: ContributionSummary | null; headingId?: string }) {
  const days = new Map(summary?.days.map((day) => [day.date, day.count]) ?? []);
  const dates = Array.from({ length: 365 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (364 - index));
    return date;
  });
  const dateKey = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  };
  const weekday = (date: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", weekday: "short" }).format(date);
  const startOffset = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<string, number>)[weekday(dates[0])] ?? 0;
  const months = dates.flatMap((date, index) => {
    const key = dateKey(date);
    if (index && dateKey(dates[index - 1]).slice(0, 7) === key.slice(0, 7)) return [];
    return [{ label: new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "short" }).format(date), column: Math.floor((startOffset + index) / 7) + 1 }];
  });
  // The first partial month can share a week with the next month. Omit its
  // label when there is not enough room, rather than creating a second row.
  const visibleMonths = months.filter((month, index) => index !== 0 || !months[1] || months[1].column - month.column >= 3);
  const weekCount = Math.ceil((startOffset + dates.length) / 7);
  return <section className="contribution-graph" aria-labelledby={headingId}>
    <div className="section-heading"><h2 id={headingId}>コントリビューション</h2><span>{summary ? `この1年 ${summary.total}件` : "読み込み中"}</span></div>
    <div className="contribution-graph__scroll" tabIndex={0} role="region" aria-label="活動カレンダー（横にスクロールできます）"><div className="contribution-graph__chart">
      <div aria-hidden="true" className="contribution-graph__weekdays"><span>月</span><span /><span>水</span><span /><span>金</span><span /><span>日</span></div>
      <div><div aria-hidden="true" className="contribution-graph__months" style={{ gridTemplateColumns: `repeat(${weekCount}, 11px)` }}>{visibleMonths.map((month) => <span key={`${month.label}-${month.column}`} style={{ gridColumnStart: month.column, gridRow: 1 }}>{month.label}</span>)}</div>
        <div className="contribution-graph__grid" aria-label="過去1年間の投稿とコメント">
          {Array.from({ length: startOffset }, (_, index) => <span aria-hidden="true" className="contribution-graph__blank" key={`blank-${index}`} />)}
          {dates.map((date) => { const key = dateKey(date); const count = days.get(key) ?? 0; return <span className={`contribution-graph__day contribution-graph__day--${count ? Math.min(4, count) : 0}`} key={key} title={`${key}: ${count}件`} />; })}
        </div>
      </div>
    </div></div>
    <p>{summary?.total ? "公開した日報とコメントの記録です。濃いほど、その日の活動数が多いことを示します。" : "まだ活動記録はありません。日報を公開するかコメントすると反映されます。"}</p>
  </section>;
}

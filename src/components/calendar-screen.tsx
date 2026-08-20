"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTIVITY_AREAS, type ActivityArea } from "@/lib/constants";
import { calendarCells, formatCalendarMonth, isCalendarMonth, isDateInCalendarMonth, monthBounds, shiftCalendarMonth } from "@/lib/calendar";
import { formatJstDate, todayInJst } from "@/lib/text";
import type { Report, ReportPage } from "@/lib/types";
import { apiRequest } from "@/components/api-client";
import { ArrowLeftIcon, ArrowRightIcon, CalendarIcon } from "@/components/icons";
import { ReportCard } from "@/components/report-card";
import { EmptyState, ErrorState, PageHeader, SkeletonList } from "@/components/ui";

type CalendarSearchParams = Record<string, string | string[] | undefined>;
const weekdays = ["月", "火", "水", "木", "金", "土", "日"];

function parameter(params: CalendarSearchParams, name: string): string {
  const value = params[name];
  return typeof value === "string" ? value : "";
}

function initialState(params: CalendarSearchParams) {
  const today = todayInJst();
  const requestedMonth = parameter(params, "month");
  const month = isCalendarMonth(requestedMonth) ? requestedMonth : today.slice(0, 7);
  const requestedDate = parameter(params, "date");
  const date = isDateInCalendarMonth(requestedDate, month) ? requestedDate : month === today.slice(0, 7) ? today : `${month}-01`;
  const requestedArea = parameter(params, "area");
  const area: ActivityArea | "" = ACTIVITY_AREAS.includes(requestedArea as ActivityArea)
    ? requestedArea as ActivityArea
    : "";
  return { month, date, area };
}

export function CalendarScreen({ initialSearchParams = {} }: { initialSearchParams?: CalendarSearchParams }) {
  const initial = useMemo(() => initialState(initialSearchParams), [initialSearchParams]);
  const [month, setMonth] = useState(initial.month);
  const [selectedDate, setSelectedDate] = useState(initial.date);
  const [activityArea, setActivityArea] = useState<ActivityArea | "">(initial.area);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = todayInJst();

  const updateAddress = useCallback((nextMonth: string, nextDate: string, nextArea: ActivityArea | "") => {
    const params = new URLSearchParams({ month: nextMonth, date: nextDate });
    if (nextArea) params.set("area", nextArea);
    window.history.replaceState(null, "", `/calendar?${params}`);
  }, []);

  const loadMonth = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const { dateFrom, dateTo } = monthBounds(month);
      const loaded: Report[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ status: "published", dateFrom, dateTo, limit: "50" });
        if (activityArea) params.set("activityArea", activityArea);
        if (cursor) params.set("cursor", cursor);
        const page = await apiRequest<ReportPage>(`/api/reports?${params}`, { signal });
        loaded.push(...page.reports);
        cursor = page.nextCursor;
      } while (cursor);
      setReports(loaded);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "カレンダーを読み込めませんでした");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activityArea, month]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void loadMonth(controller.signal), 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadMonth]);

  const counts = useMemo(() => {
    const values = new Map<string, number>();
    reports.forEach((report) => values.set(report.reportDate, (values.get(report.reportDate) ?? 0) + 1));
    return values;
  }, [reports]);
  const selectedReports = useMemo(
    () => reports.filter((report) => report.reportDate === selectedDate),
    [reports, selectedDate],
  );

  function moveMonth(amount: number) {
    const nextMonth = shiftCalendarMonth(month, amount);
    const nextDate = `${nextMonth}-01`;
    setMonth(nextMonth);
    setSelectedDate(nextDate);
    updateAddress(nextMonth, nextDate, activityArea);
  }

  function chooseDate(date: string) {
    setSelectedDate(date);
    updateAddress(month, date, activityArea);
  }

  function chooseArea(value: string) {
    const nextArea = value as ActivityArea | "";
    setActivityArea(nextArea);
    updateAddress(month, selectedDate, nextArea);
  }

  return (
    <div className="page page--wide">
      <PageHeader title="カレンダー" />
      <div className="calendar-layout">
        <section aria-labelledby="calendar-month-heading" className="calendar-panel">
          <div className="calendar-toolbar">
            <button aria-label="前月" onClick={() => moveMonth(-1)} type="button"><ArrowLeftIcon /></button>
            <h2 id="calendar-month-heading">{formatCalendarMonth(month)}</h2>
            <button aria-label="翌月" onClick={() => moveMonth(1)} type="button"><ArrowRightIcon /></button>
          </div>
          <label className="calendar-area-filter">
            <span>活動領域</span>
            <select onChange={(event) => chooseArea(event.target.value)} value={activityArea}>
              <option value="">すべて</option>
              {ACTIVITY_AREAS.map((area) => <option key={area}>{area}</option>)}
            </select>
          </label>
          <div aria-label={`${formatCalendarMonth(month)}の日報カレンダー`} className="calendar-grid" role="grid">
            {weekdays.map((weekday) => <div className="calendar-weekday" key={weekday} role="columnheader">{weekday}</div>)}
            {calendarCells(month).map((date, index) => date ? (
              <button
                aria-label={`${formatJstDate(date)}、${counts.get(date) ?? 0}件`}
                aria-selected={date === selectedDate}
                className={`calendar-day${date === today ? " calendar-day--today" : ""}`}
                key={date}
                onClick={() => chooseDate(date)}
                role="gridcell"
                type="button"
              >
                <span>{Number(date.slice(-2))}</span>
                {(counts.get(date) ?? 0) > 0 ? <strong>{counts.get(date)}件</strong> : null}
              </button>
            ) : <span aria-hidden="true" className="calendar-day calendar-day--empty" key={`empty-${index}`} />)}
          </div>
        </section>

        <section aria-labelledby="calendar-results-heading" className="calendar-results">
          <div className="calendar-results__heading">
            <div>
              <CalendarIcon />
              <h2 id="calendar-results-heading">{formatJstDate(selectedDate)}の日報</h2>
            </div>
            <span>{loading ? "読込中" : `${selectedReports.length}件`}</span>
          </div>
          {loading ? <SkeletonList count={2} /> : error ? (
            <ErrorState message={error} onRetry={() => void loadMonth()} />
          ) : selectedReports.length ? (
            <div className="report-list">
              {selectedReports.map((report) => <ReportCard key={report.id} report={report} />)}
            </div>
          ) : (
            <EmptyState message="この日に公開された日報はありません。" title="日報はありません" />
          )}
        </section>
      </div>
    </div>
  );
}

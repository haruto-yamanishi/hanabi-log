"use client";

import { useCallback, useEffect, useState } from "react";
import type { Report } from "@/lib/types";
import { apiRequest } from "@/components/api-client";
import { ReportForm } from "@/components/report-form";
import { ErrorState, LoadingView } from "@/components/ui";

export function ReportEditScreen({
  reportId,
  initialNotice,
}: {
  reportId: string;
  initialNotice?: string;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await apiRequest<Report>(`/api/reports/${reportId}`, { signal }));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "日報を読み込めませんでした");
    } finally {
      if (!signal?.aborted) setLoading(false);
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

  if (loading) return <div className="page"><LoadingView label="日報を読み込んでいます" /></div>;
  if (error || !report) return <div className="page"><ErrorState message={error || "日報が見つかりません"} onRetry={() => void load()} /></div>;
  return <ReportForm initialNotice={initialNotice} report={report} />;
}

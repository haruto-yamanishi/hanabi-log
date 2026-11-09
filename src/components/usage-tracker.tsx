"use client";
import { useEffect, useRef } from "react";

export function PresenceTracker() {
  useEffect(() => {
    function heartbeat() {
      if (document.visibilityState === "visible") void fetch("/api/analytics/presence", { method: "POST" }).catch(() => {});
    }
    heartbeat();
    const timer = window.setInterval(heartbeat, 60_000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", heartbeat); };
  }, []);
  return null;
}
export function ReportViewTracker({ reportId }: { reportId: string }) {
  const visit = useRef<{ reportId: string; id: string } | null>(null);
  useEffect(() => {
    if (visit.current?.reportId !== reportId) visit.current = { reportId, id: crypto.randomUUID() };
    const visitId = visit.current.id;
    let sent = false;
    function track() {
      if (sent || document.visibilityState !== "visible") return;
      sent = true;
      void fetch(`/api/reports/${reportId}/views`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitId }), keepalive: true }).catch(() => { sent = false; });
    }
    track();
    document.addEventListener("visibilitychange", track);
    return () => document.removeEventListener("visibilitychange", track);
  }, [reportId]);
  return null;
}

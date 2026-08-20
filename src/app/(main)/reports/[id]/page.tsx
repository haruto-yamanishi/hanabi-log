import type { Metadata } from "next";
import { ReportDetailScreen } from "@/components/report-detail-screen";

export const metadata: Metadata = { title: "日報" };

export default async function ReportDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ published?: string; updated?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const initialNotice = query.published
    ? "日報を公開しました。SlackとNotionへの同期を進めています。"
    : query.updated
      ? "変更を保存しました。公開先にも順次反映します。"
      : undefined;
  return <ReportDetailScreen initialNotice={initialNotice} reportId={id} />;
}

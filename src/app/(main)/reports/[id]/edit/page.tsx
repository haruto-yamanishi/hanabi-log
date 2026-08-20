import type { Metadata } from "next";
import { ReportEditScreen } from "@/components/report-edit-screen";

export const metadata: Metadata = { title: "日報を編集" };

export default async function EditReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  return (
    <ReportEditScreen
      initialNotice={
        saved
          ? "下書きを保存しました。外部サービスには配信されていません。"
          : undefined
      }
      reportId={id}
    />
  );
}

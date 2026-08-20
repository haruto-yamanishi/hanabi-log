import type { Metadata } from "next";
import { ReportForm } from "@/components/report-form";

export const metadata: Metadata = { title: "日報を書く" };

export default function NewReportPage() {
  return <ReportForm />;
}

import type { Metadata } from "next";
import { ArchiveScreen } from "@/components/archive-screen";

export const metadata: Metadata = { title: "アーカイブ" };

export default async function ArchivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ArchiveScreen initialSearchParams={await searchParams} />;
}

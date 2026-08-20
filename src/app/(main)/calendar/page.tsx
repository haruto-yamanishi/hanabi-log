import type { Metadata } from "next";
import { CalendarScreen } from "@/components/calendar-screen";

export const metadata: Metadata = { title: "カレンダー" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CalendarScreen initialSearchParams={await searchParams} />;
}

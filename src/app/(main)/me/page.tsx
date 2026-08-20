import type { Metadata } from "next";
import { MyScreen } from "@/components/my-screen";

export const metadata: Metadata = { title: "マイページ" };

export default function MyPage() {
  return <MyScreen />;
}

import type { Metadata } from "next";
import { AdminScreen } from "@/components/admin-screen";

export const metadata: Metadata = { title: "管理" };

export default function AdminPage() {
  return <AdminScreen />;
}

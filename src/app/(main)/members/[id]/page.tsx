import type { Metadata } from "next";
import { MemberProfileScreen } from "@/components/member-profile-screen";

export const metadata: Metadata = { title: "メンバー" };

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  return <MemberProfileScreen memberId={(await params).id} />;
}

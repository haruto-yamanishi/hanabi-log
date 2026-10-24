import type { Metadata } from "next";
import { PublicationListScreen } from "@/components/publication-screen";
export const metadata: Metadata = { title:"掲載許可" };
export default async function Page({searchParams}:{searchParams:Promise<{reportId?:string}>}) {return <PublicationListScreen reportId={(await searchParams).reportId} />;}

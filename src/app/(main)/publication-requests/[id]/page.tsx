import type { Metadata } from "next";
import { PublicationScreen } from "@/components/publication-screen";
export const metadata: Metadata = { title:"掲載許可への返事・確認" };
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{decision?:string}>}) {return <PublicationScreen id={(await params).id} initialDecision={(await searchParams).decision} />;}

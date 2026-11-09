import type { Metadata } from "next";
import { MediaScreen } from "@/components/media-screen";
export const metadata: Metadata = { title: "メディア" };
export default function MediaPage() { return <MediaScreen />; }

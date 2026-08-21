import type { Metadata, Viewport } from "next";
import { Outfit, Zen_Kaku_Gothic_New } from "next/font/google";
import type { ReactNode } from "react";
import { InitialLoadingScreen } from "@/components/initial-loading-screen";
import "./globals.css";

const zenKakuGothic = Zen_Kaku_Gothic_New({
  display: "swap",
  preload: false,
  variable: "--font-zen-kaku",
  weight: ["400", "500", "700", "900"],
});

const outfit = Outfit({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-outfit",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Hanabi Log",
    template: "%s | Hanabi Log",
  },
  description: "FRC Team Hanabiの活動・判断・学びを残す部内日報システム",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d1833",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className={`${zenKakuGothic.variable} ${outfit.variable}`} data-scroll-behavior="smooth" lang="ja">
      <body>
        <InitialLoadingScreen />
        {children}
      </body>
    </html>
  );
}

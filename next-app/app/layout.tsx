import type { Metadata } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Astra Studio — AI Video Workstation | Automated 9:16 Reels & Direct Publisher",
  description: "AI-powered creative workstation for educators and engineers. Transform raw technical lectures into viral 9:16 vertical reels with intelligent CV framing, karaoke subtitles, and one-click Instagram publishing.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0c061d] text-zinc-100 font-sans selection:bg-purple-600/40 selection:text-white">
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The NYC Hype Index — A weekly autopsy of NYC restaurant hype",
  description:
    "A weekly leaderboard of NYC restaurants ranked by the gap between TikTok virality and what locals actually think. The bigger the gap, the bigger the hype.",
  openGraph: {
    title: "The NYC Hype Index",
    description: "Ranking NYC restaurants by how overrated they are. Updated weekly.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "The NYC Hype Index",
    description: "Ranking NYC restaurants by how overrated they are. Updated weekly.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,600;0,9..144,800;0,9..144,900;1,9..144,400;1,9..144,600&family=JetBrains+Mono:wght@400;500;700&family=Inter+Tight:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

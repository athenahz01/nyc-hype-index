/**
 * Design tokens for OG share cards. Mirrors the site's palette so cards
 * look like an extension of the brand. Used inline (not Tailwind) because
 * @vercel/og renders without a CSS pipeline.
 */

export const OG_COLORS = {
    paper: "#efe9da",
    paperDark: "#e3dcc7",
    ink: "#1a1a1a",
    inkSoft: "#3d3d3d",
    muted: "#7d7468",
    hairline: "rgba(26, 26, 26, 0.18)",
    red: "#c0392b",
    gold: "#b8860b",
  } as const;
  
  export const OG_FONTS = {
    display: "Fraunces",
    mono: "JetBrains Mono",
  } as const;
  
  // Standard card dimensions for Twitter, Open Graph, Slack previews
  export const OG_SIZE = {
    width: 1200,
    height: 630,
  } as const;
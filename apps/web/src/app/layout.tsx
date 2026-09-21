import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

import { THEME_INIT_SCRIPT } from "@/lib/theme/theme-script";

import { Providers } from "./providers";

// Self-hosted at build time: the browser never contacts Google.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: {
    default: "SentinelOps",
    template: "%s · SentinelOps",
  },
  description: "Incident and operations management.",
};

export const viewport: Viewport = {
  // Dark until the stylesheet applies the user's choice (see lib/theme).
  colorScheme: "dark",
  // The situation strip's ink, so browser chrome continues it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#121620" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0f15" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script sets data-theme before React hydrates.
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* Browser extensions add attributes to <body> before React hydrates
          (ColorZilla's cz-shortcut-listen, for one). This ignores attribute
          differences on <body> alone, never its contents. */}
      <body className="min-h-dvh" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

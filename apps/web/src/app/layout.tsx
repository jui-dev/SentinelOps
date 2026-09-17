import type { Metadata } from "next";
import "./globals.css";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "SentinelOps",
    template: "%s · SentinelOps",
  },
  description: "Incident and operations management.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

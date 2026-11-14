"use client";

import "./globals.css";

import { ErrorContent } from "@/components/app/fallback-pages";
import { THEME_INIT_SCRIPT } from "@/lib/theme/theme-script";

/**
 * An error in the root layout itself, which this replaces whole: its own
 * document, the global styles, and the stored theme, applied before paint
 * as the root layout does. Deliberately plain — none of the app's
 * providers or frame, since one of them may be what failed.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Something went wrong · SentinelOps</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-canvas" suppressHydrationWarning>
        <main className="flex min-h-dvh items-center justify-center px-4 py-10">
          <div className="w-full max-w-sm rounded-lg border border-line bg-surface px-5 py-6 sm:px-7 sm:py-7">
            <ErrorContent error={error} retry={retry} />
          </div>
        </main>
      </body>
    </html>
  );
}

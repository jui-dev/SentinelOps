"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { SessionProvider } from "@/lib/auth/session-provider";
import { createQueryClient } from "@/lib/query/query-client";
import { ThemeSync } from "@/lib/theme/theme";

let browserQueryClient: QueryClient | undefined;

/**
 * One query client for the browser's lifetime, and a fresh one per server
 * render so that nothing is shared between requests.
 */
const getQueryClient = (): QueryClient => {
  if (typeof window === "undefined") return createQueryClient();

  browserQueryClient ??= createQueryClient();

  return browserQueryClient;
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <ThemeSync />
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}

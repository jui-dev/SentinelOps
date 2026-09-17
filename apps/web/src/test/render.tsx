import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { StrictMode } from "react";
import type { ReactElement } from "react";

import { SessionProvider } from "@/lib/auth/session-provider";
import { createQueryClient } from "@/lib/query/query-client";

/**
 * Renders under the real providers, in Strict Mode as the app runs in
 * development. `fetch` must already be mocked: the session provider restores
 * the session on mount.
 */
export const renderWithSession = (
  ui: ReactElement,
  queryClient: QueryClient = createQueryClient(),
) => ({
  queryClient,
  ...render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>{ui}</SessionProvider>
      </QueryClientProvider>
    </StrictMode>,
  ),
});

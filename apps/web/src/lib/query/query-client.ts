import { QueryClient } from "@tanstack/react-query";

import { isApiError } from "../api/errors";

/**
 * A 4xx is an answer — not found, not permitted, not authenticated — and
 * asking again will not change it. Network failures and 5xx get one retry.
 */
const shouldRetry = (failureCount: number, error: unknown): boolean =>
  !(isApiError(error) && error.statusCode < 500) && failureCount < 1;

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
      },
      mutations: {
        retry: false,
      },
    },
  });

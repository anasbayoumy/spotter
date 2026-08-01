import { QueryClient } from "@tanstack/react-query";

import { ApiClientError } from "../api/errors";

export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: { retry: false },
    queries: {
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (attempt, error) => error instanceof ApiClientError && error.retryable && attempt < 2,
      staleTime: 30_000,
    },
  },
});

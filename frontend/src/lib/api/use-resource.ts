"use client";

import { useQuery } from "@tanstack/react-query";

import { toApiClientError, type ApiClientError, type ApiResult } from "./client";

export interface ResourceState<T> {
  readonly data: T | null;
  readonly error: ApiClientError | null;
  readonly loading: boolean;
  readonly meta: ApiResult<T>["meta"] | null;
  readonly reload: () => void;
}

export function useResource<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<ApiResult<T>>,
): ResourceState<T> {
  const query = useQuery({
    queryFn: ({ signal }) => loader(signal),
    queryKey: ["spotter-resource", key],
  });
  return {
    data: query.data?.data ?? null,
    error: query.error === null ? null : toApiClientError(query.error),
    loading: query.isPending || query.isFetching,
    meta: query.data?.meta ?? null,
    reload: () => {
      void query.refetch();
    },
  };
}
